/**
 * Untrusted on-chain text, framed as data (EXP-AGENT prompt-injection hardening).
 *
 * Contract source, NatSpec, token names and symbols, revert strings and log data
 * are written by whoever deployed the contract. When they reach the model they
 * are wrapped in a delimiter the model is told to treat as inert data
 * (GUARDRAILS in system-prompt.ts). The wrapper:
 *   - strips control characters (which can hide or reframe text),
 *   - replaces the delimiter characters inside the text, so content cannot
 *     close the block early and "escape" into instructions,
 *   - clamps length.
 *
 * Framing is one layer. The decisive layers are structural: write preparation
 * is only offered when the user's own message asks for a write (writeIntent.ts),
 * and nothing executes without a human approval in the UI (approval.ts).
 */

export const UNTRUSTED_OPEN = "⟦untrusted";
export const UNTRUSTED_CLOSE = "⟦/untrusted⟧";

export type UntrustedKind =
  | "token-name"
  | "token-symbol"
  | "contract-name"
  | "source"
  | "natspec"
  | "revert-reason"
  | "string-value"
  | "label";

/** Make arbitrary on-chain text safe to embed: no controls, no delimiter characters. */
export function neutralize(text: string): string {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/[⟦⟧]/g, (c) => (c === "⟦" ? "[" : "]"));
}

/**
 * Wrap untrusted text. `keepNewlines` is for source files, where line structure
 * matters; single-line fields collapse whitespace.
 */
export function untrusted(kind: UntrustedKind, text: string | null | undefined, opts: { max?: number; keepNewlines?: boolean } = {}): string | null {
  if (text === null || text === undefined) return null;
  const max = opts.max ?? 200;
  let t = neutralize(text);
  if (!opts.keepNewlines) t = t.replace(/\s+/g, " ").trim();
  const clipped = t.length > max ? `${t.slice(0, max)}…` : t;
  return `${UNTRUSTED_OPEN}:${kind}⟧${clipped}${UNTRUSTED_CLOSE}`;
}

/** The inner text of a wrapped value (for UI display), or the input unchanged. */
export function unwrapUntrusted(s: string): string {
  const m = /^⟦untrusted:[a-z-]+⟧([\s\S]*)⟦\/untrusted⟧$/.exec(s);
  return m ? m[1] : s;
}

/** True when the string is exactly one wrapped block. */
export function isWrappedUntrusted(s: unknown): boolean {
  return typeof s === "string" && /^⟦untrusted:[a-z-]+⟧[\s\S]*⟦\/untrusted⟧$/.test(s) && count(s, UNTRUSTED_CLOSE) === 1;
}

function count(s: string, sub: string): number {
  return s.split(sub).length - 1;
}
