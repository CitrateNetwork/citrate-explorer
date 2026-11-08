/**
 * Approval deep links (EXP-AGENT, MCP write path).
 *
 * An MCP client can prepare a write but never execute one. Its result carries a
 * link a human opens in CitrateScan to review and approve. The link holds only
 * the REQUEST (target, function, args, value), never the simulation, the risk
 * flags or anything the dialog shows as fact: the approval page re-prepares it
 * live, from the human's own wallet, before the Approve button can be used. So a
 * forged or stale link can at worst propose a call, and the dialog shows what
 * that call really does.
 *
 * Format: `<site>/#/approve/<base64url(JSON)>`. The fragment never reaches a
 * server log.
 */
import { z } from "zod";

export const MAX_LINK_PAYLOAD_CHARS = 4096;

const argSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string().max(2048), z.number(), z.boolean(), z.array(argSchema).max(64)]),
);

export const approvalRequestSchema = z.object({
  v: z.literal(1),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  function: z.string().min(1).max(512),
  args: z.array(argSchema).max(32),
  value: z
    .string()
    .regex(/^\d{1,12}(\.\d{1,18})?$/)
    .optional(),
  /** Where the preparation came from (shown, not trusted). */
  origin: z.enum(["chat", "mcp", "ui"]).default("mcp"),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

// Works in the browser (approval page) and on the server (MCP), with no Buffer.
function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** The public site origin links point at. Fixed config, never the request's Host header. */
export function siteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NEXT_PUBLIC_SITE_URL ?? "https://explorer.citrate.ai";
  try {
    return new URL(raw).origin;
  } catch {
    return "https://explorer.citrate.ai";
  }
}

export function encodeApprovalPayload(req: Omit<ApprovalRequest, "v">): string {
  const payload = b64urlEncode(JSON.stringify({ v: 1, ...req }));
  if (payload.length > MAX_LINK_PAYLOAD_CHARS) throw new Error("the call is too large to put in an approval link");
  return payload;
}

export function approvalLink(req: Omit<ApprovalRequest, "v">, origin: string = siteOrigin()): string {
  return `${origin}/#/approve/${encodeApprovalPayload(req)}`;
}

export type ParsedApproval = { ok: true; request: ApprovalRequest } | { ok: false; error: string };

/** Parse the payload segment of `#/approve/<payload>`. Never throws. */
export function parseApprovalPayload(payload: string): ParsedApproval {
  if (!payload || payload.length > MAX_LINK_PAYLOAD_CHARS || !/^[A-Za-z0-9_-]+$/.test(payload)) {
    return { ok: false, error: "this approval link is malformed" };
  }
  let json: unknown;
  try {
    json = JSON.parse(b64urlDecode(payload));
  } catch {
    return { ok: false, error: "this approval link is malformed" };
  }
  const parsed = approvalRequestSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "this approval link does not describe a valid call" };
  return { ok: true, request: parsed.data };
}
