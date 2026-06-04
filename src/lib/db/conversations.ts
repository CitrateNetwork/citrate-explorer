/**
 * Per-user conversation persistence (WS-4). Signed-in users keep, resume, and
 * manage their "Ask CitrateScan" chats. Message bodies are sealed AES-256-GCM
 * per user (server-decryptable envelope) — at rest we store only ciphertext.
 *
 * Every function is OWNERSHIP-SCOPED (filtered by userAddress) and degrades to a
 * no-op/empty when DATABASE_URL is unset, so the agent still works without a DB
 * (it just won't persist history). The agent's tool-calls are tracked separately
 * in `audit_log` (src/lib/ai/audit.ts).
 */
import { randomUUID } from "crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { threads, messages } from "./schema";
import { sealForUser, openForUser } from "@/lib/crypto";

export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StoredMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string | null;
}

const norm = (a: string) => a.toLowerCase();

/** Create a thread for a user. Returns the new thread id, or null without a DB. */
export async function createThread(userAddress: string, title = "New chat"): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const id = randomUUID();
  await db.insert(threads).values({ id, userAddress: norm(userAddress), title: title.slice(0, 120) });
  return id;
}

/**
 * Claim a client-provided thread id for a user (so the SPA can keep one
 * conversation under a stable id it generated). Creates it if free; returns the
 * id if the user already owns it; returns null if it's taken by someone else.
 */
export async function createThreadWithId(
  userAddress: string,
  id: string,
  title = "New chat",
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  await db
    .insert(threads)
    .values({ id, userAddress: norm(userAddress), title: title.slice(0, 120) })
    .onConflictDoNothing();
  return (await ownsThread(userAddress, id)) ? id : null;
}

/** A user's threads, most-recently-updated first. */
export async function listThreads(userAddress: string, limit = 50): Promise<ThreadSummary[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(threads)
    .where(eq(threads.userAddress, norm(userAddress)))
    .orderBy(desc(threads.updatedAt))
    .limit(limit);
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    createdAt: t.createdAt?.toISOString() ?? null,
    updatedAt: t.updatedAt?.toISOString() ?? null,
  }));
}

/** True iff the thread exists AND belongs to the user. */
export async function ownsThread(userAddress: string, threadId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userAddress, norm(userAddress))))
    .limit(1);
  return Boolean(row);
}

/** Append a message to a thread (ownership-checked). Encrypts the body. */
export async function appendMessage(
  userAddress: string,
  threadId: string,
  role: "user" | "assistant" | "system",
  content: string,
): Promise<void> {
  const db = getDb();
  if (!db || !content) return;
  if (!(await ownsThread(userAddress, threadId))) return;
  const sealed = sealForUser(content, userAddress);
  await db.insert(messages).values({
    id: randomUUID(),
    threadId,
    role,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.authTag,
  });
  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
}

/** Decrypted messages for a thread (ownership-checked), oldest first. */
export async function getThreadMessages(userAddress: string, threadId: string): Promise<StoredMessage[]> {
  const db = getDb();
  if (!db) return [];
  if (!(await ownsThread(userAddress, threadId))) return [];
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt));
  return rows.map((m) => {
    let content = "";
    try {
      content = openForUser({ ciphertext: m.ciphertext, iv: m.iv, authTag: m.authTag }, userAddress);
    } catch {
      content = "";
    }
    return { id: m.id, role: m.role, content, createdAt: m.createdAt?.toISOString() ?? null };
  });
}

/** Rename a thread (ownership-checked). */
export async function renameThread(userAddress: string, threadId: string, title: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const res = await db
    .update(threads)
    .set({ title: title.slice(0, 120), updatedAt: new Date() })
    .where(and(eq(threads.id, threadId), eq(threads.userAddress, norm(userAddress))))
    .returning({ id: threads.id });
  return res.length > 0;
}

/** Delete a thread and its messages (ownership-checked). */
export async function deleteThread(userAddress: string, threadId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  if (!(await ownsThread(userAddress, threadId))) return false;
  await db.delete(messages).where(eq(messages.threadId, threadId));
  await db.delete(threads).where(eq(threads.id, threadId));
  return true;
}
