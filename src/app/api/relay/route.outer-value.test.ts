/**
 * The relayer's outer `execute` transaction always carries zero native value.
 *
 * The sponsorship policy (src/lib/relay/policy.ts) already refuses nonzero
 * request values, and the forwarder now requires `msg.value == req.value`.
 * This suite pins the third layer independently: even if the policy gate were
 * loosened, the route itself never attaches value to the relayer's
 * transaction. The policy and the chain clients are replaced with recorders so
 * the submission arguments can be inspected; no network is touched.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const sent: Array<{ functionName: string; value?: bigint; args: unknown[] }> = [];

vi.mock("@/lib/auth/session", () => ({ requireOwner: vi.fn(async () => "outer-value-subject") }));

// Model a loosened policy: everything passes. The route must still send 0.
vi.mock("@/lib/relay/policy", () => ({ checkSponsorPolicy: vi.fn(() => ({ ok: true })) }));

vi.mock("viem", async (importOriginal) => {
  const real = await importOriginal<typeof import("viem")>();
  return {
    ...real,
    createPublicClient: vi.fn(() => ({ readContract: vi.fn(async () => true) })),
    createWalletClient: vi.fn(() => ({
      writeContract: vi.fn(async (p: { functionName: string; value?: bigint; args: unknown[] }) => {
        sent.push({ functionName: p.functionName, value: p.value, args: p.args });
        return "0x" + "ab".repeat(32);
      }),
    })),
  };
});

const FORWARDER = "0x" + "f0".repeat(20);
// Deterministic, non-secret test key (never funded, never used off this test).
const TEST_RELAYER_KEY = "0x" + "11".repeat(32);
const SIG = "0x" + "1".repeat(130);
let n = 0;

function relayReq(value: string): Request {
  n += 1;
  const from = "0x" + (0xc000 + n).toString(16).padStart(40, "0");
  return new Request("http://x/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${(n % 250) + 1}` },
    body: JSON.stringify({
      request: { from, to: "0x" + "22".repeat(20), value, gas: "100000", nonce: "0", deadline: 9999999999, data: "0x" },
      signature: SIG,
    }),
  });
}

beforeEach(() => {
  sent.length = 0;
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_FORWARDER_ADDRESS", FORWARDER);
  vi.stubEnv("RELAYER_PRIVATE_KEY", TEST_RELAYER_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/relay outer transaction value", () => {
  it("submits execute with literal zero value even when the request carries value", async () => {
    const { POST } = await import("./route");
    const res = await POST(relayReq("5000000000000000000"));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].functionName).toBe("execute");
    expect(sent[0].value).toBe(0n);
  });

  it("forwards the signed request tuple unchanged (the value stays in the signed struct)", async () => {
    const { POST } = await import("./route");
    await POST(relayReq("7"));
    const tuple = (sent[0].args as [{ value: bigint }, string])[0];
    expect(tuple.value).toBe(7n);
    expect(sent[0].value).toBe(0n);
  });

  it("submits zero value for an ordinary zero-value request", async () => {
    const { POST } = await import("./route");
    const res = await POST(relayReq("0"));
    expect(res.status).toBe(200);
    expect(sent[0].value).toBe(0n);
  });
});
