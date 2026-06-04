import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { verifySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { watchlist } from "@/lib/db/schema";

/** Per-user watchlist CRUD (P-6 WP-6.3). Auth-gated; graceful-null without a DB. */
async function resolveUser(req: Request): Promise<string | null> {
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) return null;
  return auth.walletAddress ?? null;
}

export async function GET(req: Request) {
  const user = await resolveUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ provisioned: false, items: [] });
  const items = await db
    .select()
    .from(watchlist)
    .where(eq(watchlist.userAddress, user.toLowerCase()))
    .orderBy(desc(watchlist.createdAt));
  return Response.json({ provisioned: true, items });
}

const addSchema = z.object({
  target: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  label: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  const user = await resolveUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ error: "database not provisioned" }, { status: 503 });
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid address" }, { status: 400 });
  const [row] = await db
    .insert(watchlist)
    .values({
      userAddress: user.toLowerCase(),
      target: parsed.data.target.toLowerCase(),
      label: parsed.data.label ?? null,
    })
    .returning();
  return Response.json({ item: row }, { status: 201 });
}

export async function DELETE(req: Request) {
  const user = await resolveUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ error: "database not provisioned" }, { status: 503 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  await db
    .delete(watchlist)
    .where(and(eq(watchlist.id, id), eq(watchlist.userAddress, user.toLowerCase())));
  return Response.json({ ok: true });
}
