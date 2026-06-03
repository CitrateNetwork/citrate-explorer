/**
 * Tool-call audit log (S-1 WP-1.6). Every harness tool the agent invokes is
 * recorded so the settings → Transparency panel can show exactly what the agent
 * read on the user's behalf (DESIGN_HARNESS_AND_SETTINGS.md §B). Best-effort:
 * a logging failure never breaks a tool call. No-op when DB is unprovisioned.
 *
 * Data source (Rule 11): the `audit_log` table in Neon.
 */
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export async function logToolCall(
  tool: string,
  args: unknown,
  userAddress?: string,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditLog).values({
      userAddress: userAddress?.toLowerCase() ?? null,
      tool,
      args: JSON.stringify(args ?? {}).slice(0, 2000),
    });
  } catch {
    // swallow — transparency logging must never break the agent.
  }
}
