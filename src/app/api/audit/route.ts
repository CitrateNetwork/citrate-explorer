import { eq, desc } from "drizzle-orm";
import { verifySession, sessionOwner } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

/**
 * The caller's agent tool-call audit log (P-6 WP-6.5) — what the AI agent read on
 * their behalf, for the Transparency panel. Auth-gated; empty without a DB.
 * Owned by the stable OIDC `subject` (SR-0).
 */
export async function GET(req: Request) {
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const owner = sessionOwner(auth);
  const db = getDb();
  if (!db || !owner) return Response.json({ provisioned: false, entries: [] });
  const entries = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.subject, owner))
    .orderBy(desc(auditLog.createdAt))
    .limit(50);
  return Response.json({ provisioned: true, entries });
}
