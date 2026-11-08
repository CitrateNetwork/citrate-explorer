/**
 * Server half of the write-event history (see writeLog.ts for the format).
 * Writes go through src/lib/db/conversations.ts (sealed per user, ownership
 * scoped). Server-only: it reaches the database.
 */
import type { Hex } from "@/lib/contracts/types";
import { formatWriteEvent, type WriteEvent } from "./writeLog";

export interface ThreadStore {
  ownsThread(owner: string, threadId: string): Promise<boolean>;
  createThread(owner: string, title: string): Promise<string | null>;
  appendMessage(owner: string, threadId: string, role: "system", content: string): Promise<void>;
}

async function defaultStore(): Promise<ThreadStore> {
  const c = await import("@/lib/db/conversations");
  return { ownsThread: c.ownsThread, createThread: (o, t) => c.createThread(o, t), appendMessage: c.appendMessage };
}

/**
 * Append the event to `threadId` when the owner owns it, else to a new thread
 * named after the call (an approval opened from an MCP link has no chat thread).
 * Returns the thread id written to, or null when persistence is unavailable.
 */
export async function logWriteEvent(owner: string, threadId: string | null | undefined, e: WriteEvent, store?: ThreadStore): Promise<string | null> {
  const s = store ?? (await defaultStore());
  let tid: string | null = null;
  if (threadId && (await s.ownsThread(owner, threadId))) tid = threadId;
  if (!tid) tid = await s.createThread(owner, `Transaction: ${e.function} on ${e.target.slice(0, 10)}…`);
  if (!tid) return null;
  await s.appendMessage(owner, tid, "system", formatWriteEvent(e));
  return tid;
}

export interface ChainCheck {
  getTransaction: (hash: Hex) => Promise<{ to: string | null; status: string }>;
}

/** Replace the client's outcome with what the chain says about the hash. */
export async function confirmOnChain(e: WriteEvent, chain: ChainCheck): Promise<WriteEvent> {
  if (!e.txHash) return e;
  try {
    const tx = await chain.getTransaction(e.txHash as Hex);
    const targetOk = !!tx.to && tx.to.toLowerCase() === e.target.toLowerCase();
    const relayed = e.path === "relay";
    const outcome =
      `on-chain status: ${tx.status}` + (targetOk ? "" : relayed ? "; sent via the gasless forwarder" : "; WARNING: the transaction's target does not match the prepared target");
    const kind = tx.status === "success" ? "executed" : tx.status === "reverted" ? "failed" : e.kind;
    return { ...e, kind, outcome };
  } catch {
    return { ...e, outcome: "not yet visible on chain" };
  }
}
