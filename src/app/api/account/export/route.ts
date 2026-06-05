import { inArray, or, type SQL } from "drizzle-orm";
import { type AnyPgColumn } from "drizzle-orm/pg-core";
import { verifySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { settings, apiKeys, watchlist, threads } from "@/lib/db/schema";

/**
 * GDPR-style data export. Returns everything CitrateScan stores for the caller.
 * Note: `settings` ciphertext is E2EE — only the user's browser can decrypt it;
 * API keys are stored as hashes (never the raw key). On-chain data is public and
 * permanent and is intentionally NOT part of this export. Owned by the stable
 * OIDC `subject` (SR-0); legacy wallet-keyed rows are included for completeness.
 */
export async function GET(req: Request) {
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const sub = auth.sub;
  if (!sub) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) {
    return Response.json({ provisioned: false, subject: sub, data: {} });
  }
  const ids = Array.from(
    new Set([sub, auth.walletAddress, auth.walletAddress?.toLowerCase()].filter(Boolean) as string[]),
  );
  const owns = (subjectCol: AnyPgColumn, addrCol: AnyPgColumn): SQL =>
    or(inArray(subjectCol, ids), inArray(addrCol, ids))!;
  const [s, k, w, t] = await Promise.all([
    db.select().from(settings).where(owns(settings.subject, settings.userAddress)),
    db
      .select({ id: apiKeys.id, label: apiKeys.label, createdAt: apiKeys.createdAt })
      .from(apiKeys)
      .where(owns(apiKeys.subject, apiKeys.userAddress)),
    db.select().from(watchlist).where(owns(watchlist.subject, watchlist.userAddress)),
    db.select().from(threads).where(owns(threads.subject, threads.userAddress)),
  ]);
  return Response.json({
    provisioned: true,
    subject: sub,
    exportedFormat: "json",
    note: "settings are E2EE ciphertext (decrypt in your browser); api keys are hashes.",
    data: { settings: s, apiKeys: k, watchlist: w, threads: t },
  });
}
