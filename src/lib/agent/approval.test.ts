/**
 * The hard requirement, end to end with a recording fake wallet (tests only):
 * no write reaches a wallet without an approval event for exactly the
 * PreparedWrite on screen.
 *
 * The flow mirrors the product: the agent's prepare_write result → the dialog
 * re-prepares from the connected wallet → review → approve → execute.
 */
import { describe, it, expect, afterEach } from "vitest";
import { approvalBlockers, approve, execute, initialApproval, reject, replacePrepared, setPath, setTyped, settle } from "./approval";
import { createContractModule } from "./contractModule";
import { fakeChain, fakeWallet, ALICE, MALLORY, TOKEN, UNVERIFIED } from "./tests/fakeChain";
import type { PreparedWrite } from "@/lib/contracts/types";

const prep = async (fn: string, args: unknown[], o: { from?: string | null; value?: string; address?: string } = {}) => {
  const m = createContractModule(fakeChain().deps);
  return m.prepareWrite({ address: (o.address ?? TOKEN) as `0x${string}`, function: fn, args, value: o.value, from: (o.from === undefined ? ALICE : o.from) as `0x${string}` | null, origin: "chat" });
};

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
    let s = approve(initialApproval(p), ALICE);
    expect(s.approvedId).toBe(p.id);
    s = await execute(s, w.signer);
    expect(w.sent).toEqual([{ chainId: 40204, to: p.target.address, data: p.call.data, value: 0n }]);
    expect(s.phase).toBe("submitted");
    expect(s.txHash).toBe(`0x${"ab".repeat(32)}`);
    expect(settle(s, "success").phase).toBe("executed");
  });

  it("execute cannot be replayed: a submitted state refuses a second send", async () => {
    const w = fakeWallet();
    let s = approve(initialApproval(await prep("transfer", [MALLORY, "1"])), ALICE);
    s = await execute(s, w.signer);
    await expect(execute(s, w.signer)).rejects.toThrow(/not been approved/);
    expect(w.sent).toHaveLength(1);
  });

  it("an approval is bound to the PreparedWrite id: swapping the call after approval is refused", async () => {
    const w = fakeWallet();
    const a = await prep("transfer", [MALLORY, "1"]);
    const b = await prep("transfer", [MALLORY, "999"]);
    const approved = approve(initialApproval(a), ALICE);
    const swapped = { ...approved, prepared: b };
    await expect(execute(swapped, w.signer)).rejects.toThrow(/not been approved/);
    expect(w.sent).toHaveLength(0);
  });

  it("a wallet error leaves the state failed and nothing else is sent", async () => {
    const s = approve(initialApproval(await prep("transfer", [MALLORY, "1"])), ALICE);
    const out = await execute(s, { sendTransaction: async () => { throw new Error("User rejected the request"); } });
    expect(out.phase).toBe("failed");
    expect(out.error).toMatch(/User rejected/);
  });
});

describe("approve preconditions", () => {
  it("needs a connected wallet", async () => {
    const s = initialApproval(await prep("transfer", [MALLORY, "1"]));
    expect(approvalBlockers(s, null)).toContain("connect your wallet");
    expect(() => approve(s, null)).toThrow(/connect your wallet/);
  });

  it("needs a simulation run from the connected wallet (a chat preparation without sender is not approvable)", async () => {
    const s = initialApproval(await prep("transfer", [MALLORY, "1"], { from: null }));
    expect(approvalBlockers(s, ALICE)).toContain("re-simulate from your connected wallet first");
    const other = initialApproval(await prep("transfer", [MALLORY, "1"], { from: MALLORY }));
    expect(() => approve(other, ALICE)).toThrow(/re-simulate/);
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

describe("elevated writes need the typed confirmation", () => {
  it("approve(spender, amount) is blocked until the user types the phrase", async () => {
    const w = fakeWallet();
    let s = initialApproval(await prep("approve", [MALLORY, "1000"]));
    expect(s.prepared.risk.elevated).toBe(true);
    expect(() => approve(s, ALICE)).toThrow(/type "approve"/);
    s = setTyped(s, "aprove");
    expect(() => approve(s, ALICE)).toThrow(/type "approve"/);
    s = setTyped(s, "approve");
    s = await execute(approve(s, ALICE), w.signer);
    expect(w.sent).toHaveLength(1);
  });

  it("a reverting simulation is elevated: it can be sent only after typing the phrase", async () => {
    const s = initialApproval(await prep("transfer", [MALLORY, "5000"]));
    expect(s.prepared.simulation.ok).toBe(false);
    expect(approvalBlockers(s, ALICE).join()).toMatch(/type "transfer"/);
  });

  it("a call to an unverified contract is elevated", async () => {
    const s = initialApproval(await prep("poke(uint256)", ["1"], { address: UNVERIFIED }));
    expect(s.prepared.risk.flags.map((f) => f.code)).toContain("unverified-target");
    expect(() => approve(s, ALICE)).toThrow(/type "poke"/);
  });
});

describe("reject and edit paths", () => {
  it("reject ends the flow; nothing can be executed afterwards", async () => {
    const w = fakeWallet();
    const s = reject(initialApproval(await prep("transfer", [MALLORY, "1"])));
    expect(s.phase).toBe("rejected");
    expect(() => approve(s, ALICE)).toThrow(/already rejected/);
    await expect(execute(s, w.signer)).rejects.toThrow();
    expect(w.sent).toHaveLength(0);
  });

  it("an edit voids an earlier approval and starts a fresh review with a new id", async () => {
    const w = fakeWallet();
    const first = await prep("approve", [MALLORY, "1"]);
    let s = approve(setTyped(initialApproval(first), "approve"), ALICE);
    const edited = await prep("approve", [MALLORY, "2"]);
    s = replacePrepared(s, edited);
    expect(s.phase).toBe("review");
    expect(s.approvedId).toBeNull();
    expect(s.typed).toBe("");
    expect(s.history).toEqual([first.id, edited.id]);
    await expect(execute(s, w.signer)).rejects.toThrow(/not been approved/);
    expect(w.sent).toHaveLength(0);
  });
});

describe("the gasless relay path", () => {
  it("is blocked when the relay policy does not allow the call", async () => {
    const s = setPath(initialApproval(await prep("transfer", [MALLORY, "1"])), "relay");
    expect(approvalBlockers(s, ALICE).join()).toMatch(/gasless relay cannot sponsor/);
  });

  it("when allowed, the user still approves, and the relay (not the wallet send) is used once", async () => {
    process.env.RELAY_TARGET_ALLOWLIST = TOKEN;
    const w = fakeWallet();
    let s = setPath(initialApproval(await prep("transfer", [MALLORY, "1"])), "relay");
    await expect(execute(s, w.signer)).rejects.toThrow(/not been approved/);
    s = await execute(approve(s, ALICE), w.signer);
    expect(w.sponsored).toHaveLength(1);
    expect(w.sent).toHaveLength(0);
    expect(s.txHash).toBe(`0x${"cd".repeat(32)}`);
  });
});
