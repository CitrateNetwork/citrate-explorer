/**
 * Server-side Privy session verification. Confirms the caller is authenticated
 * and returns their wallet address, used to scope per-user data (settings, keys,
 * watchlist, threads) and to enforce that a sponsored meta-tx's `from` matches.
 *
 * When Privy env is not configured (local dev before credentials), enforcement
 * is disabled (`required: false`) so the app runs — production must set both
 * NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET.
 */
export interface SessionResult {
  required: boolean;
  ok: boolean;
  address?: string;
}

export async function verifyPrivySession(req: Request): Promise<SessionResult> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) return { required: false, ok: false };

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { required: true, ok: false };

  try {
    const { PrivyClient } = await import("@privy-io/server-auth");
    const privy = new PrivyClient(appId, secret);
    const claims = await privy.verifyAuthToken(token);
    const user = await privy.getUser(claims.userId);
    return { required: true, ok: true, address: user.wallet?.address };
  } catch {
    return { required: true, ok: false };
  }
}
