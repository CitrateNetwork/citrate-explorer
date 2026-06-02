import { eq } from "drizzle-orm";
import { verifyPrivySession } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { settings, apiKeys, watchlist, threads } from "@/lib/db/schema";

/**
 * GDPR-style data export. Returns everything CitrateScan stores for the caller.
 * Note: `settings` ciphertext is E2EE — only the user's browser can decrypt it;
 * API keys are stored as hashes (never the raw key). On-chain data is public and
 * permanent and is intentionally NOT part of this export.
 */
async function resolveUser(req: Request): Promise<string | null> {
  const auth = await verifyPrivySession(req);
  if (auth.required && !auth.ok) return null;
  return auth.address ?? req.headers.get("x-dev-address") ?? null;
}

export async function GET(req: Request) {
  const user = await resolveUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) {
    return Response.json({ provisioned: false, address: user, data: {} });
  }
  const u = user.toLowerCase();
  const [s, k, w, t] = await Promise.all([
    db.select().from(settings).where(eq(settings.userAddress, u)),
    db
      .select({ id: apiKeys.id, label: apiKeys.label, createdAt: apiKeys.createdAt })
      .from(apiKeys)
      .where(eq(apiKeys.userAddress, u)),
    db.select().from(watchlist).where(eq(watchlist.userAddress, u)),
    db.select().from(threads).where(eq(threads.userAddress, u)),
  ]);
  return Response.json({
    provisioned: true,
    address: u,
    exportedFormat: "json",
    note: "settings are E2EE ciphertext (decrypt in your browser); api keys are hashes.",
    data: { settings: s, apiKeys: k, watchlist: w, threads: t },
  });
}
