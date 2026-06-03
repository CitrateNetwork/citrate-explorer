/**
 * OPTIONAL Privy server adapter — only loaded when AUTH_MODE=privy.
 *
 * This is the ONLY server file permitted to import Privy. It exists so the
 * "existing Privy flow" remains available as a temporary backend while
 * auth.citrate.ai is built. The default path is the mock issuer; production will
 * use `oidc`. Do not import this from anywhere except `session.ts`'s dynamic import.
 */
import type { AuthSession } from "../types";

export async function verifyPrivy(req: Request): Promise<AuthSession> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) return { required: false, authenticated: false };

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  if (!token) return { required: true, authenticated: false };

  try {
    const { PrivyClient } = await import("@privy-io/server-auth");
    const privy = new PrivyClient(appId, secret);
    const claims = await privy.verifyAuthToken(token);
    const user = await privy.getUser(claims.userId);
    const walletAddress = user.wallet?.address?.toLowerCase();
    return { required: true, authenticated: true, sub: claims.userId, walletAddress };
  } catch {
    return { required: true, authenticated: false };
  }
}
