import { verifySession } from "@/lib/auth/session";
import { listThreads, createThread } from "@/lib/db/conversations";

/**
 * The signed-in user's conversation threads (WS-4). Auth-gated; ownership-scoped
 * inside the repository. Empty without a DB (persistence not provisioned).
 */
export async function GET(req: Request) {
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = auth.sub;
  if (!user) return Response.json({ provisioned: false, threads: [] });
  return Response.json({ provisioned: true, threads: await listThreads(user) });
}

export async function POST(req: Request) {
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = auth.sub;
  if (!user) return Response.json({ error: "sign in to save conversations" }, { status: 401 });
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  const id = await createThread(user, title || "New chat");
  if (!id) return Response.json({ provisioned: false }, { status: 503 });
  return Response.json({ id });
}
