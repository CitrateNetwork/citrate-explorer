/**
 * Auth seam entry. Import the concrete halves directly to keep client and server
 * bundles separate:
 *   - client components → `@/lib/auth/client`  (AuthProvider, useAuth)
 *   - server / API routes → `@/lib/auth/session` (verifySession, sessionAddress)
 * Only the provider-agnostic TYPES are safe to barrel-export here.
 */
export type { AuthSession, AuthContextValue, AuthMode } from "./types";
