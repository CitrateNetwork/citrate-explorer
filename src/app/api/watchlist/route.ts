import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { watchlist } from "@/lib/db/schema";
import { checkSameOrigin } from "@/lib/security/sameOrigin";

/**
 * Per-user watchlist CRUD (P-6 WP-6.3). Auth-gated; graceful-null without a DB.
 * Owned by the stable OIDC `subject` (SR-0). SR-3 layers client-side E2EE on top
 * (the POST also accepts an encrypted envelope + blind index); this SR-0 revision
 * keeps the plaintext path working while moving ownership to `subject`.
 */
export async function GET(req: Request) {
  const owner = await requireOwner(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ provisioned: false, items: [] });
  const items = await db
    .select()
    .from(watchlist)
    .where(eq(watchlist.subject, owner))
    .orderBy(desc(watchlist.createdAt));
  return Response.json({ provisioned: true, items });
}

/**
 * Two accepted shapes (SR-3):
 *  - ENCRYPTED (preferred, zero-knowledge): the client encrypts `{address,label}`
 *    with its wallet/PRF-derived key and sends `{ciphertext, iv, blindIndex}`. The
 *    server stores ciphertext (in `target`) + iv + a keyed `blindIndex` HMAC and
 *    NEVER sees the address. Alerts match the blind index client-side.
 *  - PLAINTEXT (fallback when E2EE is locked): `{target,label}` — stored as before,
 *    `encrypted=false`. Disclosed honestly in the UI.
 */
const encryptedSchema = z.object({
  ciphertext: z.string().min(1).max(4096),
  iv: z.string().min(1).max(64),
  blindIndex: z.string().min(1).max(128),
});
const plaintextSchema = z.object({
  target: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  label: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  // PBA-L3c-018: cookie-authenticated mutation → same-origin only.
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const owner = await requireOwner(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ error: "database not provisioned" }, { status: 503 });
  const body = await req.json().catch(() => null);

  const enc = encryptedSchema.safeParse(body);
  if (enc.success) {
    const [row] = await db
      .insert(watchlist)
      .values({
        userAddress: owner,
        subject: owner,
        target: enc.data.ciphertext,
        iv: enc.data.iv,
        blindIndex: enc.data.blindIndex,
        encrypted: true,
      })
      .returning();
    return Response.json({ item: row }, { status: 201 });
  }

  const plain = plaintextSchema.safeParse(body);
  if (!plain.success) return Response.json({ error: "invalid payload" }, { status: 400 });
  const [row] = await db
    .insert(watchlist)
    .values({
      userAddress: owner,
      subject: owner,
      target: plain.data.target.toLowerCase(),
      label: plain.data.label ?? null,
      encrypted: false,
    })
    .returning();
  return Response.json({ item: row }, { status: 201 });
}

export async function DELETE(req: Request) {
  // PBA-L3c-018: cookie-authenticated mutation → same-origin only.
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const owner = await requireOwner(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ error: "database not provisioned" }, { status: 503 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  await db
    .delete(watchlist)
    .where(and(eq(watchlist.id, id), eq(watchlist.subject, owner)));
  return Response.json({ ok: true });
}
