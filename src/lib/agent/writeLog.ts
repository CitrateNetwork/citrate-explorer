/**
 * Write events in the user's thread history (EXP-AGENT approvals).
 *
 * Every prepared, edited, approved, rejected, executed or failed write is
 * appended to the user's conversation as a `system` message whose body is a
 * tagged JSON line. It uses the existing threads/messages tables, so it is
 * sealed per user (AES-256-GCM) and ownership-scoped like every other message,
 * and it shows up in the drawer when a conversation is resumed.
 *
 * Data source (Rule 11): `threads` + `messages` via src/lib/db/conversations.ts.
 *
 * This file is the shared, pure half (schema and message format), safe in the
 * browser bundle. The server half that writes is writeLogServer.ts.
 */
import { z } from "zod";
import type { PreparedWrite } from "@/lib/contracts/types";

export const WRITE_EVENT_TAG = "[citrate-write-event]";

export const WRITE_EVENT_KINDS = ["prepared", "edited", "approved", "rejected", "submitted", "executed", "failed"] as const;
export type WriteEventKind = (typeof WRITE_EVENT_KINDS)[number];

export const writeEventSchema = z.object({
  kind: z.enum(WRITE_EVENT_KINDS),
  preparedId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  chainId: z.literal(40204),
  target: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  function: z.string().max(200),
  signature: z.string().max(600),
  valueSalt: z.string().max(80),
  riskCodes: z.array(z.string().max(40)).max(20),
  origin: z.enum(["chat", "mcp", "ui"]),
  path: z.enum(["wallet", "relay"]).optional(),
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  outcome: z.string().max(300).optional(),
  at: z.string().max(40),
});
export type WriteEvent = z.infer<typeof writeEventSchema>;

export function writeEventFrom(
  kind: WriteEventKind,
  p: PreparedWrite,
  extra: { path?: "wallet" | "relay"; txHash?: string; outcome?: string; at?: string } = {},
): WriteEvent {
  return {
    kind,
    preparedId: p.id,
    chainId: 40204,
    target: p.target.address,
    function: p.call.function.slice(0, 200),
    signature: p.call.signature.slice(0, 600),
    valueSalt: p.value.salt,
    riskCodes: p.risk.flags.map((f) => f.code),
    origin: p.origin,
    ...(extra.path ? { path: extra.path } : {}),
    ...(extra.txHash ? { txHash: extra.txHash } : {}),
    ...(extra.outcome ? { outcome: extra.outcome.slice(0, 300) } : {}),
    at: extra.at ?? new Date().toISOString(),
  };
}

export function formatWriteEvent(e: WriteEvent): string {
  return `${WRITE_EVENT_TAG} ${JSON.stringify(e)}`;
}

/** The event in a stored message body, or null when it is not one. */
export function parseWriteEvent(content: string): WriteEvent | null {
  if (!content.startsWith(WRITE_EVENT_TAG)) return null;
  try {
    const parsed = writeEventSchema.safeParse(JSON.parse(content.slice(WRITE_EVENT_TAG.length).trim()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
