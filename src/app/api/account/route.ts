import { inArray, or, type SQL } from "drizzle-orm";
import { type AnyPgColumn } from "drizzle-orm/pg-core";
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
import { checkSameOrigin } from "@/lib/security/sameOrigin";

/**
 * GDPR right-to-erasure. Deletes ALL account-scoped data we store for the
 * authenticated caller. On-chain data (blocks, transactions, addresses) is
 * public and permanent and is NOT ours to delete — the response says so plainly.
 *
 * Ownership is the stable OIDC `subject` (SR-0), but during the additive
 * migration legacy rows may be keyed only by the old wallet `user_address`.
 * Erasure must be COMPLETE, so we match `subject = sub` OR `user_address ∈
 * {sub, wallet}` across every owner table.
 */
export async function DELETE(req: Request) {
  // PBA-L3c-018: cookie-authenticated mutation → same-origin only.
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const sub = auth.sub;
  if (!sub) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  if (!db) {
    return Response.json(
      { deleted: false, note: "No database is provisioned; nothing is stored to erase." },
      { status: 503 },
    );
  }

  // Candidate owner identifiers: the stable subject plus the (legacy) wallet.
  const ids = Array.from(
    new Set([sub, auth.walletAddress, auth.walletAddress?.toLowerCase()].filter(Boolean) as string[]),
  );
  // Build a per-table "owned by me" predicate over (subject | user_address).
  const owns = (subjectCol: AnyPgColumn, addrCol: AnyPgColumn): SQL =>
    or(inArray(subjectCol, ids), inArray(addrCol, ids))!;

  // Threads first (messages + memory hang off thread ids).
  const userThreads = await db
    .select({ id: threads.id })
    .from(threads)
    .where(owns(threads.subject, threads.userAddress));
  const threadIds = userThreads.map((t) => t.id);
  if (threadIds.length) {
    await db.delete(messages).where(inArray(messages.threadId, threadIds));
    await db.delete(threadMemory).where(inArray(threadMemory.threadId, threadIds));
  }
  await db.delete(threads).where(owns(threads.subject, threads.userAddress));
  await db.delete(settings).where(owns(settings.subject, settings.userAddress));
  await db.delete(apiKeys).where(owns(apiKeys.subject, apiKeys.userAddress));
  await db.delete(watchlist).where(owns(watchlist.subject, watchlist.userAddress));
  await db.delete(providerKeys).where(owns(providerKeys.subject, providerKeys.userAddress));
  await db.delete(auditLog).where(owns(auditLog.subject, auditLog.userAddress));

  return Response.json({
    deleted: true,
    subject: sub,
    note:
      "Account-scoped data erased (settings, API keys, watchlist, provider keys, " +
      "chat threads/messages, audit log). On-chain data is public and permanent " +
      "and is unaffected.",
  });
}
