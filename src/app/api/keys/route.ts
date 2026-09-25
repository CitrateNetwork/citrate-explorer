import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/api/ratelimit";
import { countActiveKeys, MAX_ACTIVE_KEYS_PER_SUBJECT } from "@/lib/api/keys";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { generateApiKey, hashApiKey } from "@/lib/crypto";
import { checkSameOrigin } from "@/lib/security/sameOrigin";

/**
 * API-key management (hybrid storage): we store only a salted hash, so a new key
 * is shown to the user exactly ONCE on creation and is never recoverable
 * (CONFIG.md, DESIGN_HARNESS_AND_SETTINGS.md §B). Owned by the stable OIDC
 * `subject` (SR-0); `user_address` is dual-written transitionally.
 */

/** List the caller's API keys (metadata only — never the key or hash). */
export async function GET(req: Request) {
  const owner = await requireOwner(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ provisioned: false, keys: [] });
  const rows = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      quotaPerDay: apiKeys.quotaPerDay,
      rateLimitPerSec: apiKeys.rateLimitPerSec,
      revoked: apiKeys.revoked,
      createdAt: apiKeys.createdAt,
      lastUsed: apiKeys.lastUsed,
    })
    .from(apiKeys)
    .where(eq(apiKeys.subject, owner));
  return Response.json({ provisioned: true, keys: rows });
}

/** PBA-L3c-013: a short printable label (no control characters), default "default". */
const mintSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[^\p{Cc}]+$/u)
    .optional(),
});

/** Issue a new API key. The raw key is returned ONCE; only its hash is stored. */
export async function POST(req: Request) {
  // PBA-L3c-018: cookie-authenticated mutation → same-origin only.
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const owner = await requireOwner(req);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) {
    return Response.json(
      { error: "database not provisioned (DATABASE_URL unset)" },
      { status: 503 },
    );
  }
  const parsed = mintSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "label must be 1-64 printable characters" }, { status: 400 });
  }

  // PBA-L3c-013: throttle minting per owner (3 now, then one a minute), and cap
  // the number of live keys so they cannot be stacked to multiply rate budgets.
  const minted = await checkRateLimit(`keys:mint:${owner}`, 1 / 60, 3, { failClosed: true });
  if (!minted.ok) {
    return Response.json(
      { error: "too many keys created recently" },
      { status: 429, headers: { "retry-after": String(minted.retryAfter ?? 60) } },
    );
  }
  if ((await countActiveKeys(owner)) >= MAX_ACTIVE_KEYS_PER_SUBJECT) {
    return Response.json(
      { error: `at most ${MAX_ACTIVE_KEYS_PER_SUBJECT} active API keys; revoke one first` },
      { status: 409 },
    );
  }

  const rawKey = generateApiKey();
  await db.insert(apiKeys).values({
    userAddress: owner,
    subject: owner,
    keyHash: hashApiKey(rawKey),
    label: parsed.data.label ?? "default",
  });
  return Response.json(
    {
      key: rawKey,
      warning: "Copy this key now — it is shown only once and cannot be recovered.",
    },
    { status: 201 },
  );
}

/** Revoke (delete) one of the caller's API keys by id. */
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
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.subject, owner)));
  return Response.json({ ok: true });
}
