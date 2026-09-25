import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { checkSameOrigin } from "@/lib/security/sameOrigin";

/**
 * E2EE user settings (P-6 WP-6.2). The client encrypts settings in the browser
 * with a key derived from the auth-seam key material (embedded-wallet signature or
 * WebAuthn PRF — src/lib/crypto-client.ts) and sends only ciphertext + iv. The
 * server stores them verbatim and can NEVER read them. Ownership is keyed by the
 * stable OIDC `subject` (SR-0); `user_address` is dual-written transitionally.
 */
export async function GET(req: Request) {
  const owner = await requireOwner(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ provisioned: false, settings: null });
  const [row] = await db
    .select({ ciphertext: settings.ciphertext, iv: settings.iv, updatedAt: settings.updatedAt })
    .from(settings)
    .where(eq(settings.subject, owner))
    .limit(1);
  return Response.json({ provisioned: true, settings: row ?? null });
}

const schema = z.object({ ciphertext: z.string().min(1), iv: z.string().min(1) });

export async function PUT(req: Request) {
  // PBA-L3c-018: cookie-authenticated mutation → same-origin only.
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const owner = await requireOwner(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ error: "database not provisioned" }, { status: 503 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid payload" }, { status: 400 });

  await db
    .insert(settings)
    .values({ userAddress: owner, subject: owner, ciphertext: parsed.data.ciphertext, iv: parsed.data.iv })
    .onConflictDoUpdate({
      target: settings.subject,
      set: { ciphertext: parsed.data.ciphertext, iv: parsed.data.iv, updatedAt: new Date() },
    });
  return Response.json({ ok: true });
}
