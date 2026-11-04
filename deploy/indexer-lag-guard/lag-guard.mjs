#!/usr/bin/env node
/**
 * CitrateScan indexer lag guard (EXP-S0). Run once a minute by
 * citratescan-indexer-lag-guard.timer on the indexer host.
 *
 * Each run reads the local node's head block (`eth_getBlockByNumber("latest")`)
 * and compares its timestamp with the wall clock. A check is stale when the head
 * is more than LAG_GUARD_MAX_AGE_SEC (60) seconds old, or the RPC cannot answer.
 * After LAG_GUARD_CONSECUTIVE (5) stale checks in a row, it stops
 * citratescan-indexer.service (if active) and logs why, so the indexer stops
 * loading a node that is behind. A fresh check resets the streak.
 *
 * It never starts or restarts anything, and the only unit it touches is the
 * indexer unit: it never stops or restarts the node. Restarting the indexer is
 * a human decision (see README.md).
 *
 * Data source (Rule 7): the local node's JSON-RPC at LAG_GUARD_RPC_URL.
 * State: a small JSON file (the streak) in LAG_GUARD_STATE_FILE.
 * No dependencies: Node >= 18 (global fetch).
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ stale: number, lastCheck: number | null,
 *   lastHead: { number: number, timestamp: number } | null, lastReason: string | null }} GuardState
 */

/** @type {Readonly<GuardState>} */
export const INITIAL_STATE = Object.freeze({ stale: 0, lastCheck: null, lastHead: null, lastReason: null });

const UNIT_RE = /^citratescan-indexer[A-Za-z0-9_.@-]*\.service$/;

function positiveInt(name, raw, dflt) {
  if (raw === undefined || raw === "") return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${raw}`);
  return n;
}

/**
 * Reads and validates the configuration from the environment.
 * @param {Record<string, string | undefined>} [env]
 */
export function guardConfig(env = process.env) {
  const unit = env.LAG_GUARD_UNIT || "citratescan-indexer.service";
  if (!UNIT_RE.test(unit)) {
    throw new Error(`LAG_GUARD_UNIT must be a citratescan-indexer*.service unit, got ${unit}`);
  }
  return {
    rpcUrl: env.LAG_GUARD_RPC_URL || "http://127.0.0.1:8545",
    maxAgeSec: positiveInt("LAG_GUARD_MAX_AGE_SEC", env.LAG_GUARD_MAX_AGE_SEC, 60),
    consecutive: positiveInt("LAG_GUARD_CONSECUTIVE", env.LAG_GUARD_CONSECUTIVE, 5),
    timeoutMs: positiveInt("LAG_GUARD_TIMEOUT_MS", env.LAG_GUARD_TIMEOUT_MS, 10_000),
    stateFile: env.LAG_GUARD_STATE_FILE || "/var/lib/citratescan-lag-guard/state.json",
    unit,
  };
}

function sanitizeState(s) {
  const stale = s && Number.isInteger(s.stale) && s.stale >= 0 ? s.stale : 0;
  return { ...INITIAL_STATE, ...(s && typeof s === "object" ? s : {}), stale };
}

/**
 * Pure decision. `obs` is `{ ok: true, headTimestamp, headNumber }` or
 * `{ ok: false, error }`. Returns the next state, whether to stop the indexer,
 * and a one-line reason.
 */
export function evaluate(prev, obs, nowSec, cfg) {
  const state = sanitizeState(prev);
  let staleNow;
  let why;
  if (obs.ok) {
    const age = nowSec - obs.headTimestamp;
    staleNow = age > cfg.maxAgeSec;
    why = `head ${obs.headNumber} is ${age} s old`;
  } else {
    staleNow = true;
    why = `the node RPC did not answer (${obs.error})`;
  }
  const stale = staleNow ? state.stale + 1 : 0;
  const limit = `${stale} consecutive stale check(s), limit ${cfg.consecutive}`;
  const reason = !staleNow ? `${why}; fresh` : obs.ok ? `${why} (> ${cfg.maxAgeSec} s); ${limit}` : `${why}; ${limit}`;
  return {
    state: {
      stale,
      lastCheck: nowSec,
      lastHead: obs.ok ? { number: obs.headNumber, timestamp: obs.headTimestamp } : state.lastHead,
      lastReason: reason,
    },
    stop: stale >= cfg.consecutive,
    reason,
  };
}

/** One guard run with injected I/O. Returns what it did. */
export async function runCheck({ config, now, readHead, readState, writeState, systemctl, log }) {
  let obs;
  try {
    const head = await readHead();
    obs = { ok: true, headTimestamp: head.timestamp, headNumber: head.number };
  } catch (e) {
    obs = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let prev;
  try {
    prev = await readState();
  } catch {
    prev = INITIAL_STATE;
  }
  const r = evaluate(prev, obs, now(), config);
  await writeState(r.state);

  if (!r.stop) {
    log(`[lag-guard] ${r.reason}`);
    return { stopped: false, reason: r.reason };
  }
  const active = await systemctl(["is-active", "--quiet", config.unit]);
  if (active.code !== 0) {
    log(`[lag-guard] ${r.reason}; ${config.unit} is not active, nothing to stop`);
    return { stopped: false, reason: r.reason };
  }
  log(`[lag-guard] stopping ${config.unit}: ${r.reason}. The node is not touched. Restart the indexer by hand once the node is at head.`);
  const res = await systemctl(["stop", config.unit]);
  if (res.code !== 0) {
    log(`[lag-guard] systemctl stop ${config.unit} failed (exit ${res.code}): ${res.stderr ?? ""}`);
    return { stopped: false, reason: r.reason, error: res.code };
  }
  return { stopped: true, reason: r.reason };
}

async function rpcHead(cfg) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`RPC error ${body.error.code}: ${body.error.message}`);
    const b = body.result;
    if (!b || typeof b.timestamp !== "string" || typeof b.number !== "string") throw new Error("no latest block");
    return { number: Number(BigInt(b.number)), timestamp: Number(BigInt(b.timestamp)) };
  } finally {
    clearTimeout(t);
  }
}

function systemctlExec(args) {
  return new Promise((resolve) => {
    execFile("systemctl", args, (err, _stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stderr: String(stderr ?? "").trim() });
    });
  });
}

async function main() {
  const config = guardConfig();
  const out = await runCheck({
    config,
    now: () => Math.floor(Date.now() / 1000),
    readHead: () => rpcHead(config),
    readState: async () => JSON.parse(await readFile(config.stateFile, "utf8")),
    writeState: async (s) => {
      await mkdir(dirname(config.stateFile), { recursive: true });
      const tmp = `${config.stateFile}.tmp`;
      await writeFile(tmp, JSON.stringify(s) + "\n");
      await rename(tmp, config.stateFile);
    },
    systemctl: systemctlExec,
    log: (l) => console.log(l),
  });
  process.exitCode = out.error ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("[lag-guard] fatal:", err);
    process.exitCode = 1;
  });
}
