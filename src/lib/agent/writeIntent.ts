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

/**
 * Imperative verbs that ask for a state change on their own ("approve the
 * router", "stake 10 here"). Deliberately narrow: verbs that are as often reads
 * or prose ("set", "call", "update", "list", "create", "write", "prepare") only
 * count in the explicit form below ("prepare a transaction ...").
 */
const IMPERATIVE_VERBS = new Set([
  "send", "transfer", "approve", "revoke", "mint", "burn", "stake", "unstake", "restake", "deposit", "withdraw",
  "claim", "register", "unregister", "delegate", "undelegate", "vote", "swap", "bridge", "pay", "redeem", "bond",
  "unbond", "renounce", "grant", "wrap", "unwrap", "upgrade", "buy", "sell", "bid", "execute", "submit", "sign",
]);

/** "send / execute / sign / write / prepare / build … a transaction (tx, write, contract call)". */
const TX_VERBS = new Set(["send", "submit", "execute", "sign", "broadcast", "prepare", "draft", "build", "make", "create", "write", "construct", "queue"]);
const TX_NOUN = /\b(transaction|transactions|tx|txs|txn|contract call|a write|the write|this write|that write)\b/;

/** A clause that opens like this is a question about something, not a request to do it. */
const QUESTION_START = /^(what|whats|what's|why|how|when|where|who|whom|which|whose|is|are|was|were|am|do|does|did|can|could|should|would|will|shall|may|might|must|has|have|had|explain|show|tell|describe|list|summari[sz]e|compare|walk me through|teach)\b/;

/** Openers that turn what follows into a request ("can you …", "please …", "I want to …"). */
const REQUEST_OPENERS = [
  /^(please|pls|kindly)\s+/,
  /^(can|could|would|will)\s+you\s+(please\s+)?/,
  // Each optional piece is anchored by a literal ("'d", "would", "you") so no two
  // whitespace runs can both match the same spaces: no polynomial backtracking
  // (CodeQL js/polynomial-redos) even if the input were not whitespace-collapsed.
  /^i(?:\s*'d|\s+would)?\s+(?:want|like|need)\s+(?:you\s+)?to\s+/,
  /^i\s+want\s+you\s+to\s+/,
  /^(let'?s|let\s+me|help\s+me|go\s+ahead\s+and|now|then|also)\s+/,
];
const FILLERS = /^(ok(ay)?|so|and|then|now|yes|yeah|yep|sure|great|thanks|thank you|alright|right|cool|hey|hi)\b[\s,]*/;

function isRequestClause(raw: string): boolean {
  let c = raw.toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4 && FILLERS.test(c); i++) c = c.replace(FILLERS, "").trim();
  let opened = false;
  for (let i = 0; i < 3; i++) {
    const before = c;
    for (const re of REQUEST_OPENERS) c = c.replace(re, "");
    if (c === before) break;
    opened = true;
  }
  if (!opened && QUESTION_START.test(c)) return false;
  const first = /^[a-z]+/.exec(c)?.[0] ?? "";
  if (TX_VERBS.has(first) && TX_NOUN.test(c)) return true;
  if (!IMPERATIVE_VERBS.has(first)) return false;
  // "send me the ABI" asks for information, not value: needs an amount or an address to be a transfer.
  if (first === "send" && /^send (me|us)\b/.test(c) && !/\d|0x[0-9a-f]{40}/.test(c)) return false;
  return true;
}

const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const CONTEXT_TARGET_KINDS = new Set<AgentContext["kind"]>(["address", "contract", "token"]);

export interface WriteGate {
  /** prepare_write may be offered this turn */
  allowed: boolean;
  /** lowercased addresses the user named or is looking at */
  targets: ReadonlySet<string>;
  reason: string;
}

/**
 * True when the user's own message explicitly asks for a transaction: an
 * imperative state-changing action, or a request to send, execute, sign, write or
 * prepare a transaction. Questions about writes are reads. Deterministic.
 */
export function hasWriteIntent(userText: string): boolean {
  return userText
    .split(/[.!;\n]+|\?(?=\s|$)/)
    .map((c) => c.trim())
    .filter(Boolean)
    .some(isRequestClause);
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
