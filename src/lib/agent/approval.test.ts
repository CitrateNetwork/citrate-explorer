/**
 * The hard requirement, end to end with a recording fake wallet (tests only):
 * no write reaches a wallet without an approval for exactly the PreparedWrite on
 * screen.
 *
 * The flow mirrors the product: a request (agent prepare_write, MCP link, or the
 * contract page's form) → the dialog prepares it through the kit from the
 * connected wallet → review → approve (kit approveWrite, in the click) → execute
 * (kit executeWrite).
 */
import { describe, it, expect, afterEach } from "vitest";
import { approvalBlockers, approve, execute, initialApproval, reject, replacePrepared, setAcknowledged, setPath, setTyped, settle, type ApprovalState } from "./approval";
import { fakeChain, fakeWallet, kitPrepare, ACTIVATED, NOT_ACTIVATED, ALICE, MALLORY, TOKEN, UNVERIFIED } from "./tests/fakeChain";
import type { PreparedWrite } from "@/lib/contract/kit";

const prep = async (fn: string, args: unknown[], o: { from?: string | null; value?: string; address?: string } = {}) =>
  kitPrepare(fakeChain(), {
    address: (o.address ?? TOKEN) as `0x${string}`,
    function: fn,
    args,
    value: o.value,
    from: (o.from === undefined ? ALICE : o.from) as `0x${string}` | null,
  });

/** Tick every high risk (the dialog's checkboxes). */
const ackAll = (s: ApprovalState) => s.prepared.risks.filter((r) => r.severity === "high").reduce((acc, r) => setAcknowledged(acc, r.code, true), s);

afterEach(() => {
  delete process.env.RELAY_TARGET_ALLOWLIST;
});

describe("nothing signs without approval", () => {
  it("execute refuses a prepared write that was never approved; the wallet is never called", async () => {
    const w = fakeWallet();
    const s = initialApproval(await prep("transfer", [MALLORY, "1"]));
    await expect(execute(s, w.signer)).rejects.toThrow(/not been approved/);
    expect(w.sent).toHaveLength(0);
    expect(w.sponsored).toHaveLength(0);
  });

  it("approve → execute calls the wallet exactly once with the prepared calldata, value and chain 40204", async () => {
    const w = fakeWallet();
    const p = await prep("transfer", [MALLORY, "1"]);
    let s = approve(initialApproval(p), ALICE, ACTIVATED);
    expect(s.approvedId).toBe(p.id);
    s = await execute(s, w.signer);
    expect(w.sent).toEqual([{ chainId: 40204, to: p.to, data: p.data, value: 0n, gas: 60_000n }]);
    expect(s.phase).toBe("submitted");
    expect(s.txHash).toBe(`0x${"ab".repeat(32)}`);
    expect(settle(s, "success").phase).toBe("executed");
  });

  it("an approval can only be made from a user gesture (kit approveWrite)", async () => {
    const s = initialApproval(await prep("transfer", [MALLORY, "1"]));
    expect(() => approve(s, ALICE, NOT_ACTIVATED)).toThrow(/user gesture/);
  });

  it("execute cannot be replayed: a submitted state refuses a second send", async () => {
    const w = fakeWallet();
    let s = approve(initialApproval(await prep("transfer", [MALLORY, "1"])), ALICE, ACTIVATED);
    s = await execute(s, w.signer);
    await expect(execute(s, w.signer)).rejects.toThrow(/not been approved/);
    expect(w.sent).toHaveLength(1);
  });

  it("the kit approval is single use even if the dialog state is rewound to approved", async () => {
    const w = fakeWallet();
    const approved = approve(initialApproval(await prep("transfer", [MALLORY, "1"])), ALICE, ACTIVATED);
    await execute(approved, w.signer);
    const replay = await execute(approved, w.signer);
    expect(replay.phase).toBe("failed");
    expect(replay.error).toMatch(/already used/);
    expect(w.sent).toHaveLength(1);
  });

  it("an approval is bound to the PreparedWrite id: swapping the call after approval is refused", async () => {
    const w = fakeWallet();
    const a = await prep("transfer", [MALLORY, "1"]);
    const b = await prep("transfer", [MALLORY, "999"]);
    const approved = approve(initialApproval(a), ALICE, ACTIVATED);
    const swapped = { ...approved, prepared: b };
    await expect(execute(swapped, w.signer)).rejects.toThrow(/not been approved/);
    // Even with the id rewritten to match, the kit refuses an approval made for another preparation.
    const forged = await execute({ ...swapped, approvedId: b.id }, w.signer);
    expect(forged.phase).toBe("failed");
    expect(forged.error).toMatch(/does not match/);
    expect(w.sent).toHaveLength(0);
  });

  it("two preparations of the same call get different ids (an approval never carries over)", async () => {
    const a = await prep("transfer", [MALLORY, "1"]);
    const b = await prep("transfer", [MALLORY, "1"]);
    expect(a.id).not.toBe(b.id);
  });

  it("a stale preparation (older than 120 s) cannot be approved or sent", async () => {
    const w = fakeWallet();
    const p = await prep("transfer", [MALLORY, "1"]);
    const s = initialApproval(p);
    expect(approvalBlockers(s, ALICE, p.preparedAt + 121_000).join()).toMatch(/re-simulate/);
    const approved = approve(s, ALICE, ACTIVATED);
    const out = await execute(approved, w.signer, { now: () => p.preparedAt + 121_000 });
    expect(out.phase).toBe("failed");
    expect(out.error).toMatch(/stale/);
    expect(w.sent).toHaveLength(0);
  });

  it("a wallet error leaves the state failed and nothing else is sent", async () => {
    const s = approve(initialApproval(await prep("transfer", [MALLORY, "1"])), ALICE, ACTIVATED);
    const out = await execute(s, { sendTransaction: async () => { throw new Error("User rejected the request"); } });
    expect(out.phase).toBe("failed");
    expect(out.error).toMatch(/User rejected/);
  });
});

describe("approve preconditions", () => {
  it("needs a connected wallet", async () => {
    const s = initialApproval(await prep("transfer", [MALLORY, "1"]));
    expect(approvalBlockers(s, null)).toContain("connect your wallet");
    expect(() => approve(s, null, ACTIVATED)).toThrow(/connect your wallet/);
  });

  it("needs a simulation run from the connected wallet (a chat preparation without sender is not approvable)", async () => {
    const s = initialApproval(await prep("transfer", [MALLORY, "1"], { from: null }));
    expect(approvalBlockers(s, ALICE)).toContain("re-simulate from your connected wallet first");
    const other = initialApproval(await prep("transfer", [MALLORY, "1"], { from: MALLORY }));
    expect(() => approve(other, ALICE, ACTIVATED)).toThrow(/re-simulate/);
  });

  it("refuses a request for another network", async () => {
    const p = await prep("transfer", [MALLORY, "1"]);
    const forged = { ...p, chainId: 1 } as unknown as PreparedWrite;
    expect(approvalBlockers(initialApproval(forged), ALICE)).toContain("wrong network: expected chain 40204");
  });

  it("refuses an object that claims to be executable", async () => {
    const p = await prep("transfer", [MALLORY, "1"]);
    const forged = { ...p, executable: true } as unknown as PreparedWrite;
    expect(approvalBlockers(initialApproval(forged), ALICE)).toContain("malformed request");
  });
});

describe("elevated writes need the high risks acknowledged AND the typed confirmation", () => {
  it("approve(spender, amount) is blocked until the user ticks the risks and types the phrase", async () => {
    const w = fakeWallet();
    let s = initialApproval(await prep("approve", [MALLORY, "1000"]));
    expect(s.prepared.elevated).toBe(true);
    expect(() => approve(s, ALICE, ACTIVATED)).toThrow(/type "approve"/);
    s = setTyped(s, "aprove");
    expect(() => approve(s, ALICE, ACTIVATED)).toThrow(/type "approve"/);
    s = setTyped(s, "approve");
    expect(() => approve(s, ALICE, ACTIVATED)).toThrow(/acknowledge/);
    s = ackAll(s);
    s = await execute(approve(s, ALICE, ACTIVATED), w.signer);
    expect(w.sent).toHaveLength(1);
  });

  it("unticking a risk blocks approval again", async () => {
    let s = ackAll(setTyped(initialApproval(await prep("approve", [MALLORY, "1000"])), "approve"));
    expect(approvalBlockers(s, ALICE)).toEqual([]);
    s = setAcknowledged(s, "token-approval", false);
    expect(approvalBlockers(s, ALICE).join()).toMatch(/acknowledge/);
  });

  it("a reverting simulation is elevated: it can be sent only after typing the phrase", async () => {
    const s = initialApproval(await prep("transfer", [MALLORY, "5000"]));
    expect(s.prepared.simulation.status).toBe("reverted");
    expect(approvalBlockers(s, ALICE).join()).toMatch(/type "transfer"/);
  });

  it("a call to an unverified contract is elevated", async () => {
    const s = initialApproval(await prep("poke(uint256)", ["1"], { address: UNVERIFIED }));
    expect(s.prepared.risks.map((f) => f.code)).toContain("unverified-target");
    expect(() => approve(s, ALICE, ACTIVATED)).toThrow(/type "poke"/);
  });
});

describe("reject and edit paths", () => {
  it("reject ends the flow; nothing can be executed afterwards", async () => {
    const w = fakeWallet();
    const s = reject(initialApproval(await prep("transfer", [MALLORY, "1"])));
    expect(s.phase).toBe("rejected");
    expect(() => approve(s, ALICE, ACTIVATED)).toThrow(/already rejected/);
    await expect(execute(s, w.signer)).rejects.toThrow();
    expect(w.sent).toHaveLength(0);
  });

  it("an edit voids an earlier approval and starts a fresh review with a new id", async () => {
    const w = fakeWallet();
    const first = await prep("approve", [MALLORY, "1"]);
    let s = approve(ackAll(setTyped(initialApproval(first), "approve")), ALICE, ACTIVATED);
    const edited = await prep("approve", [MALLORY, "2"]);
    s = replacePrepared(s, edited);
    expect(s.phase).toBe("review");
    expect(s.approvedId).toBeNull();
    expect(s.approval).toBeNull();
    expect(s.typed).toBe("");
    expect(s.acknowledged).toEqual([]);
    expect(s.history).toEqual([first.id, edited.id]);
    await expect(execute(s, w.signer)).rejects.toThrow(/not been approved/);
    expect(w.sent).toHaveLength(0);
  });
});

describe("the gasless relay path", () => {
  it("is blocked when the relay policy does not allow the call", async () => {
    const s = setPath(initialApproval(await prep("transfer", [MALLORY, "1"])), "gasless");
    expect(approvalBlockers(s, ALICE).join()).toMatch(/gasless relay cannot sponsor/);
  });

  it("when allowed, the user still approves, and the relay (not the wallet send) is used once", async () => {
    process.env.RELAY_TARGET_ALLOWLIST = TOKEN;
    const w = fakeWallet();
    let s = setPath(initialApproval(await prep("transfer", [MALLORY, "1"])), "gasless");
    await expect(execute(s, w.signer)).rejects.toThrow(/not been approved/);
    s = await execute(approve(s, ALICE, ACTIVATED), w.signer);
    expect(w.sponsored).toHaveLength(1);
    expect(w.sent).toHaveLength(0);
    expect(s.txHash).toBe(`0x${"cd".repeat(32)}`);
  });
});
