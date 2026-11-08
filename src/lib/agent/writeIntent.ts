/**
 * The write-intent gate (EXP-AGENT prompt-injection hardening).
 *
 * The chat model is only offered `prepare_write` in a turn where the USER'S OWN
 * latest message asks for a state change, and only for a target the user named
 * in that message or is looking at (the page context). Both inputs come from the
 * user, never from tool output, so text planted in a token name, NatSpec, a
 * revert string or log data cannot turn write preparation on or point it at a
 * different contract. Even when the gate is open, a prepared write still only
 * executes after the user approves it in the dialog.
 *
 * Deterministic, no model involved.
 */
import type { AgentContext } from "@/lib/contracts/types";

/** Verbs that mean "change state". Matched as whole words in the user's text. */
const WRITE_VERBS = [
  "send", "transfer", "approve", "revoke", "mint", "burn", "stake", "unstake", "restake", "deposit",
  "withdraw", "claim", "register", "unregister", "call", "execute", "write", "submit", "prepare", "set",
  "update", "upgrade", "vote", "delegate", "undelegate", "swap", "bridge", "pay", "buy", "sell", "create",
  "grant", "renounce", "lock", "unlock", "redeem", "bond", "unbond", "join", "exit", "cancel", "list", "bid",
];
const WRITE_RE = new RegExp(`\\b(${WRITE_VERBS.join("|")})\\b`, "i");
const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const CONTEXT_TARGET_KINDS = new Set<AgentContext["kind"]>(["address", "contract", "token"]);

export interface WriteGate {
  /** prepare_write may be offered this turn */
  allowed: boolean;
  /** lowercased addresses the user named or is looking at */
  targets: ReadonlySet<string>;
  reason: string;
}

export function hasWriteIntent(userText: string): boolean {
  return WRITE_RE.test(userText);
}

export function namedTargets(userText: string, context?: AgentContext | null): Set<string> {
  const set = new Set<string>();
  for (const m of userText.matchAll(ADDRESS_RE)) set.add(m[0].toLowerCase());
  if (context && CONTEXT_TARGET_KINDS.has(context.kind) && context.id && /^0x[0-9a-fA-F]{40}$/.test(context.id)) {
    set.add(context.id.toLowerCase());
  }
  return set;
}

export function writeGate(lastUserText: string, context?: AgentContext | null): WriteGate {
  const targets = namedTargets(lastUserText, context);
  if (!hasWriteIntent(lastUserText)) {
    return { allowed: false, targets, reason: "your message does not ask for a transaction" };
  }
  if (targets.size === 0) {
    return { allowed: false, targets, reason: "name the contract address (or open its page) to prepare a transaction" };
  }
  return { allowed: true, targets, reason: "requested by you in this message" };
}

/** The chat tools that only exist behind the gate. */
export const GATED_WRITE_TOOLS = ["prepare_write"] as const;
