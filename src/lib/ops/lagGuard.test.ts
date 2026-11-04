/**
 * EXP-S0 indexer lag guard (deploy/indexer-lag-guard). Every minute, a systemd
 * timer reads the local node's head timestamp. After 5 consecutive checks with
 * the head more than 60 s old, it stops citratescan-indexer.service and logs
 * why. It never starts, restarts or stops anything else (never the node).
 */
import { describe, expect, it } from "vitest";
import {
  evaluate,
  guardConfig,
  runCheck,
  INITIAL_STATE,
} from "../../../deploy/indexer-lag-guard/lag-guard.mjs";

const cfg = guardConfig({});
const NOW = 1_800_000_000;

describe("guardConfig", () => {
  it("defaults: local node RPC, 60 s, 5 checks, the indexer unit", () => {
    expect(cfg).toMatchObject({
      rpcUrl: "http://127.0.0.1:8545",
      maxAgeSec: 60,
      consecutive: 5,
      unit: "citratescan-indexer.service",
    });
  });

  it("refuses to manage any unit other than a citratescan-indexer unit", () => {
    expect(() => guardConfig({ LAG_GUARD_UNIT: "citrate-node.service" })).toThrow(/citratescan-indexer/);
    expect(() => guardConfig({ LAG_GUARD_UNIT: "citratescan-indexer.service; reboot" })).toThrow();
    expect(guardConfig({ LAG_GUARD_UNIT: "citratescan-indexer-r1007.service" }).unit).toBe(
      "citratescan-indexer-r1007.service",
    );
  });

  it("rejects nonsense thresholds", () => {
    expect(() => guardConfig({ LAG_GUARD_MAX_AGE_SEC: "0" })).toThrow();
    expect(() => guardConfig({ LAG_GUARD_CONSECUTIVE: "-1" })).toThrow();
  });
});

describe("evaluate", () => {
  it("a fresh head resets the streak", () => {
    const r = evaluate({ ...INITIAL_STATE, stale: 4 }, { ok: true, headTimestamp: NOW - 10, headNumber: 7 }, NOW, cfg);
    expect(r.state.stale).toBe(0);
    expect(r.stop).toBe(false);
  });

  it("stops only on the 5th consecutive stale check", () => {
    let state = INITIAL_STATE;
    const stops: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const r = evaluate(state, { ok: true, headTimestamp: NOW - 61, headNumber: 7 }, NOW, cfg);
      state = r.state;
      stops.push(r.stop);
    }
    expect(stops).toEqual([false, false, false, false, true]);
    expect(state.stale).toBe(5);
  });

  it("exactly 60 s old is not stale", () => {
    const r = evaluate({ ...INITIAL_STATE, stale: 4 }, { ok: true, headTimestamp: NOW - 60, headNumber: 7 }, NOW, cfg);
    expect(r.state.stale).toBe(0);
  });

  it("an RPC error counts as a stale check", () => {
    const r = evaluate({ ...INITIAL_STATE, stale: 4 }, { ok: false, error: "ECONNREFUSED" }, NOW, cfg);
    expect(r.stop).toBe(true);
    expect(r.reason).toMatch(/ECONNREFUSED/);
  });

  it("the reason names the head age, the threshold and the streak", () => {
    const r = evaluate({ ...INITIAL_STATE, stale: 4 }, { ok: true, headTimestamp: NOW - 300, headNumber: 412 }, NOW, cfg);
    expect(r.reason).toMatch(/head 412/);
    expect(r.reason).toMatch(/300 s old/);
    expect(r.reason).toMatch(/> 60 s/);
    expect(r.reason).toMatch(/5 consecutive/);
  });
});

describe("runCheck", () => {
  function harness(opts: { head: () => Promise<{ number: number; timestamp: number }>; active?: boolean; state?: object }) {
    const calls: string[][] = [];
    const logs: string[] = [];
    let saved: unknown = opts.state ?? INITIAL_STATE;
    return {
      calls,
      logs,
      saved: () => saved as { stale: number },
      deps: {
        config: cfg,
        now: () => NOW,
        readHead: opts.head,
        readState: async () => saved,
        writeState: async (s: unknown) => {
          saved = s;
        },
        systemctl: async (args: string[]) => {
          calls.push(args);
          if (args[0] === "is-active") return { code: opts.active === false ? 3 : 0 };
          return { code: 0 };
        },
        log: (l: string) => logs.push(l),
      },
    };
  }

  it("stops the indexer on the 5th stale minute and logs why", async () => {
    const h = harness({ head: async () => ({ number: 9, timestamp: NOW - 120 }), state: { ...INITIAL_STATE, stale: 4 } });
    const out = await runCheck(h.deps);
    expect(out).toMatchObject({ stopped: true });
    expect(h.calls).toEqual([
      ["is-active", "--quiet", "citratescan-indexer.service"],
      ["stop", "citratescan-indexer.service"],
    ]);
    expect(h.logs.join("\n")).toMatch(/stopping citratescan-indexer\.service: head 9 is 120 s old/);
  });

  it("does nothing to systemd while the head is fresh", async () => {
    const h = harness({ head: async () => ({ number: 9, timestamp: NOW - 2 }) });
    await runCheck(h.deps);
    expect(h.calls).toEqual([]);
    expect(h.saved().stale).toBe(0);
  });

  it("does not stop an indexer that is already stopped", async () => {
    const h = harness({ head: async () => ({ number: 9, timestamp: NOW - 120 }), state: { ...INITIAL_STATE, stale: 7 }, active: false });
    const out = await runCheck(h.deps);
    expect(out.stopped).toBe(false);
    expect(h.calls).toEqual([["is-active", "--quiet", "citratescan-indexer.service"]]);
  });

  it("only ever calls is-active and stop on the indexer unit", async () => {
    for (const ts of [NOW - 1, NOW - 500]) {
      for (const stale of [0, 4, 10]) {
        const h = harness({ head: async () => ({ number: 1, timestamp: ts }), state: { ...INITIAL_STATE, stale } });
        await runCheck(h.deps);
        for (const c of h.calls) {
          expect(["is-active", "stop"]).toContain(c[0]);
          expect(c[c.length - 1]).toBe("citratescan-indexer.service");
        }
      }
    }
    const err = harness({ head: async () => Promise.reject(new Error("timeout")), state: { ...INITIAL_STATE, stale: 4 } });
    await runCheck(err.deps);
    expect(err.calls.map((c) => c[0])).toEqual(["is-active", "stop"]);
  });

  it("a corrupt state file starts a new streak instead of failing", async () => {
    const h = harness({ head: async () => ({ number: 9, timestamp: NOW - 120 }), state: { stale: "x" } });
    await runCheck(h.deps);
    expect(h.saved().stale).toBe(1);
  });
});
