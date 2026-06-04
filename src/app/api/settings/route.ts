import { eq } from "drizzle-orm";
import { z } from "zod";
import { verifySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

/**
 * E2EE user settings (P-6 WP-6.2). The client encrypts settings in the browser
 * with a key derived from a wallet signature (src/lib/crypto-client.ts) and sends
 * only ciphertext + iv. The server stores them verbatim and can NEVER read them.
 * This is the "settings sync across devices, zero-knowledge" path.
 */
async function resolveUser(req: Request): Promise<string | null> {
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) return null;
  return auth.walletAddress ?? null;
}

export async function GET(req: Request) {
  const user = await resolveUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ provisioned: false, settings: null });
  const [row] = await db
    .select({ ciphertext: settings.ciphertext, iv: settings.iv, updatedAt: settings.updatedAt })
    .from(settings)
    .where(eq(settings.userAddress, user.toLowerCase()))
    .limit(1);
  return Response.json({ provisioned: true, settings: row ?? null });
}

const schema = z.object({ ciphertext: z.string().min(1), iv: z.string().min(1) });

export async function PUT(req: Request) {
  const user = await resolveUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ error: "database not provisioned" }, { status: 503 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid payload" }, { status: 400 });

  const u = user.toLowerCase();
  await db
    .insert(settings)
    .values({ userAddress: u, ciphertext: parsed.data.ciphertext, iv: parsed.data.iv })
    .onConflictDoUpdate({
      target: settings.userAddress,
      set: { ciphertext: parsed.data.ciphertext, iv: parsed.data.iv, updatedAt: new Date() },
    });
  return Response.json({ ok: true });
}
