import { verifySession } from "@/lib/auth/session";
import { getThreadMessages, renameThread, deleteThread } from "@/lib/db/conversations";
import { checkSameOrigin } from "@/lib/security/sameOrigin";

/** A single conversation: its messages (GET), rename (PATCH), delete (DELETE). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = auth.sub;
  const { id } = await params;
  if (!user) return Response.json({ messages: [] });
  return Response.json({ id, messages: await getThreadMessages(user, id) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // PBA-L3c-018: cookie-authenticated mutation → same-origin only.
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = auth.sub;
  const { id } = await params;
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  if (!title) return Response.json({ error: "title required" }, { status: 400 });
  const ok = await renameThread(user, id, title);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // PBA-L3c-018: cookie-authenticated mutation → same-origin only.
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = auth.sub;
  const { id } = await params;
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const ok = await deleteThread(user, id);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
