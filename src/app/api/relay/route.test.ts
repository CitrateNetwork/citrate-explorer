import { describe, it, expect } from "vitest";
import { POST } from "./route";
import { CONTRACT_ADDRESSES } from "@/lib/citrate/addresses";

// CIT-EXP-01 (RM-Q, 2026-09-06): the gasless relay must refuse to sponsor
// native value and must refuse arbitrary `to` targets, BEFORE any chain
// interaction and regardless of whether the forwarder is provisioned. These
// asserts are the HTTP-layer twin of policy.test.ts.

const KNOWN_CONTRACT = Object.values(CONTRACT_ADDRESSES)[0] as string;
const ATTACKER_EOA = "0x" + "a".repeat(40);
const SIG = "0x" + "1".repeat(130);

let n = 0;
function relayReq(request: Record<string, unknown>): Request {
  // Unique from-address + IP per call so the hourly rate limiter never trips.
  const from = "0x" + (n++).toString(16).padStart(40, "0");
  return new Request("http://x/api/relay", {
    method: "POST",
    body: JSON.stringify({ request: { from, ...request }, signature: SIG }),
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(n % 250) + 1}` },
  });
}

const base = { gas: "21000", nonce: "0", deadline: 9999999999, data: "0x" };

describe("/api/relay sponsorship policy (CIT-EXP-01)", () => {
  it("400 — refuses to sponsor a native value transfer (the drain vector)", async () => {
    const res = await POST(
      relayReq({ to: ATTACKER_EOA, value: "1000000000000000000", ...base }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/value must be 0/);
  });

  it("400 — refuses value even to a known contract", async () => {
    const res = await POST(relayReq({ to: KNOWN_CONTRACT, value: "1", ...base }));
    expect(res.status).toBe(400);
  });

  it("400 — refuses an arbitrary (non-allowlisted) target", async () => {
    const res = await POST(relayReq({ to: ATTACKER_EOA, value: "0", ...base }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/allowlisted federation contract/);
  });

  it("passes the policy gate for value=0 to an allowlisted contract (503 only because unprovisioned, not 400)", async () => {
    const res = await POST(relayReq({ to: KNOWN_CONTRACT, value: "0", ...base }));
    // The forwarder is not provisioned in tests, so a policy-accepted request
    // stops at the 503 provisioning gate — proving the policy did NOT reject it.
    expect(res.status).toBe(503);
  });
});
