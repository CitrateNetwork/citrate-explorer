import { eq, desc } from "drizzle-orm";
import { verifySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

/**
 * The caller's agent tool-call audit log (P-6 WP-6.5) — what the AI agent read on
 * their behalf, for the Transparency panel. Auth-gated; empty without a DB.
 */
export async function GET(req: Request) {
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = auth.walletAddress;
  const db = getDb();
  if (!db || !user) return Response.json({ provisioned: false, entries: [] });
  const entries = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.userAddress, user.toLowerCase()))
    .orderBy(desc(auditLog.createdAt))
    .limit(50);
  return Response.json({ provisioned: true, entries });
}
