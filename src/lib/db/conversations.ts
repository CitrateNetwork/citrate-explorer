/**
 * Per-user conversation persistence (WS-4). Signed-in users keep, resume, and
 * manage their "Ask CitrateScan" chats. Message bodies are sealed AES-256-GCM
 * per user (server-decryptable envelope) — at rest we store only ciphertext.
 *
 * Every function is OWNERSHIP-SCOPED by the stable OIDC `subject` (SR-0) so
 * email/social/passkey identities with no wallet are first-class. The subject is
 * an opaque, case-sensitive identifier — it is stored/compared VERBATIM (never
 * lower-cased). `user_address` is dual-written (= subject) transitionally and
 * dropped at the cutover migration. Degrades to a no-op/empty when DATABASE_URL
 * is unset, so the agent still works without a DB (it just won't persist history).
 * The agent's tool-calls are tracked separately in `audit_log`.
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

/** Create a thread for an owner. Returns the new thread id, or null without a DB. */
export async function createThread(owner: string, title = "New chat"): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const id = randomUUID();
  await db.insert(threads).values({ id, userAddress: owner, subject: owner, title: title.slice(0, 120) });
  return id;
}

/**
 * Claim a client-provided thread id for an owner (so the SPA can keep one
 * conversation under a stable id it generated). Creates it if free; returns the
 * id if the owner already owns it; returns null if it's taken by someone else.
 */
export async function createThreadWithId(
  owner: string,
  id: string,
  title = "New chat",
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  await db
    .insert(threads)
    .values({ id, userAddress: owner, subject: owner, title: title.slice(0, 120) })
    .onConflictDoNothing();
  return (await ownsThread(owner, id)) ? id : null;
}

/** An owner's threads, most-recently-updated first. */
export async function listThreads(owner: string, limit = 50): Promise<ThreadSummary[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(threads)
    .where(eq(threads.subject, owner))
    .orderBy(desc(threads.updatedAt))
    .limit(limit);
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    createdAt: t.createdAt?.toISOString() ?? null,
    updatedAt: t.updatedAt?.toISOString() ?? null,
  }));
}

/** True iff the thread exists AND belongs to the owner. */
export async function ownsThread(owner: string, threadId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.subject, owner)))
    .limit(1);
  return Boolean(row);
}

/** Append a message to a thread (ownership-checked). Encrypts the body. */
export async function appendMessage(
  owner: string,
  threadId: string,
  role: "user" | "assistant" | "system",
  content: string,
): Promise<void> {
  const db = getDb();
  if (!db || !content) return;
  if (!(await ownsThread(owner, threadId))) return;
  const sealed = sealForUser(content, owner);
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
export async function getThreadMessages(owner: string, threadId: string): Promise<StoredMessage[]> {
  const db = getDb();
  if (!db) return [];
  if (!(await ownsThread(owner, threadId))) return [];
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt));
  return rows.map((m) => {
    let content = "";
    try {
      content = openForUser({ ciphertext: m.ciphertext, iv: m.iv, authTag: m.authTag }, owner);
    } catch {
      content = "";
    }
    return { id: m.id, role: m.role, content, createdAt: m.createdAt?.toISOString() ?? null };
  });
}

/** Rename a thread (ownership-checked). */
export async function renameThread(owner: string, threadId: string, title: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const res = await db
    .update(threads)
    .set({ title: title.slice(0, 120), updatedAt: new Date() })
    .where(and(eq(threads.id, threadId), eq(threads.subject, owner)))
    .returning({ id: threads.id });
  return res.length > 0;
}

/** Delete a thread and its messages (ownership-checked). */
export async function deleteThread(owner: string, threadId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  if (!(await ownsThread(owner, threadId))) return false;
  await db.delete(messages).where(eq(messages.threadId, threadId));
  await db.delete(threads).where(eq(threads.id, threadId));
  return true;
}
