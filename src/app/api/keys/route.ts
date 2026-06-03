import { eq } from "drizzle-orm";
import { verifySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { generateApiKey, hashApiKey } from "@/lib/crypto";

/**
 * API-key management (hybrid storage): we store only a salted hash, so a new key
 * is shown to the user exactly ONCE on creation and is never recoverable
 * (CONFIG.md, DESIGN_HARNESS_AND_SETTINGS.md §B).
 */
async function resolveUser(req: Request): Promise<string | null> {
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) return null;
  return auth.walletAddress ?? null;
}

/** List the caller's API keys (metadata only — never the key or hash). */
export async function GET(req: Request) {
  const user = await resolveUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
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
    .where(eq(apiKeys.userAddress, user.toLowerCase()));
  return Response.json({ provisioned: true, keys: rows });
}

/** Issue a new API key. The raw key is returned ONCE; only its hash is stored. */
export async function POST(req: Request) {
  const user = await resolveUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) {
    return Response.json(
      { error: "database not provisioned (DATABASE_URL unset)" },
      { status: 503 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { label?: string };
  const rawKey = generateApiKey();
  await db.insert(apiKeys).values({
    userAddress: user.toLowerCase(),
    keyHash: hashApiKey(rawKey),
    label: body.label ?? "default",
  });
  return Response.json(
    {
      key: rawKey,
      warning: "Copy this key now — it is shown only once and cannot be recovered.",
    },
    { status: 201 },
  );
}
