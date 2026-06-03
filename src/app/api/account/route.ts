import { eq, inArray } from "drizzle-orm";
import { verifySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  settings,
  apiKeys,
  watchlist,
  threads,
  messages,
  threadMemory,
  providerKeys,
  auditLog,
} from "@/lib/db/schema";

/**
 * GDPR right-to-erasure. Deletes ALL account-scoped data we store for the
 * authenticated caller. On-chain data (blocks, transactions, addresses) is
 * public and permanent and is NOT ours to delete — the response says so plainly.
 */
async function resolveUser(req: Request): Promise<string | null> {
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) return null;
  return auth.walletAddress ?? null;
}

export async function DELETE(req: Request) {
  const user = await resolveUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  if (!db) {
    return Response.json(
      { deleted: false, note: "No database is provisioned; nothing is stored to erase." },
      { status: 503 },
    );
  }

  const u = user.toLowerCase();

  // Threads are keyed by user; messages + memory hang off thread ids.
  const userThreads = await db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.userAddress, u));
  const threadIds = userThreads.map((t) => t.id);
  if (threadIds.length) {
    await db.delete(messages).where(inArray(messages.threadId, threadIds));
    await db.delete(threadMemory).where(inArray(threadMemory.threadId, threadIds));
  }
  await db.delete(threads).where(eq(threads.userAddress, u));
  await db.delete(settings).where(eq(settings.userAddress, u));
  await db.delete(apiKeys).where(eq(apiKeys.userAddress, u));
  await db.delete(watchlist).where(eq(watchlist.userAddress, u));
  await db.delete(providerKeys).where(eq(providerKeys.userAddress, u));
  await db.delete(auditLog).where(eq(auditLog.userAddress, u));

  return Response.json({
    deleted: true,
    address: u,
    note:
      "Account-scoped data erased (settings, API keys, watchlist, provider keys, " +
      "chat threads/messages, audit log). On-chain data is public and permanent " +
      "and is unaffected.",
  });
}
