// @ts-nocheck
/* eslint-disable */
/* CitrateScan — read-only chain + indexer harness (simulated front-end mirror of
   the server-side harness in DESIGN_HARNESS_AND_SETTINGS.md). Read-only BY
   CONSTRUCTION: no signer, no keys, no write path. Every read passes the same
   allowlist + validation + audit. Data is illustrative testnet-shaped sample. */
import { SD } from "./data";

const D = SD;
const FORBIDDEN = D.ALLOWLIST.forbidden;
const ALLOWED = D.ALLOWLIST.allowed;

// running audit log (newest first), seeded from sample
const audit = D.AUDIT.map((a, i) => ({ id: "ax" + i, ts: Date.now() - i * 4000, ...a }));

function record(op, backing, latency, decoded, cache) {
  const e = { id: "ax" + (audit.length + 1000), ts: Date.now(), op, backing, latency, decoded, cache, age: "now" };
  audit.unshift(e);
  if (audit.length > 80) audit.pop();
  return e;
}

function guard(method) {
  // forbidden checked FIRST (defense in depth) then allowlist
  if (FORBIDDEN.includes(method)) throw new Error("forbidden method: " + method);
  if (!ALLOWED.includes(method)) throw new Error("method not allowlisted: " + method);
  return true;
}

function run(op, backing, fn, opts) {
  opts = opts || {};
  guard(backing);
  const lat = Math.round(8 + Math.random() * 48);
  const data = fn();
  record(op, backing, lat, opts.decoded !== false, !!opts.cache);
  return { ok: true, latency: lat, blueScore: D.CHAIN.blueScore, data };
}

// classify omni-search by input shape (A6)
function classify(q) {
  const s = (q || "").trim();
  if (!s) return { kind: "empty" };
  if (/^\d+$/.test(s)) return { kind: "block", value: s };
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) {
    // tx hash or block hash — try tx first
    if (D.TX[s]) return { kind: "tx", value: s };
    return { kind: "tx", value: s }; // resolver will fall back
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) {
    const isC = D.CONTRACT[s.toLowerCase()] || (D.ADDR[s] && D.ADDR[s].isContract);
    return { kind: isC ? "contract" : "address", value: s };
  }
  // short forms used in the prototype (0x…4 form)
  if (D.txByShort[s]) return { kind: "tx", value: D.txByShort[s] };
  // label match
  const lab = Object.values(D.L).find((e) => e.label.toLowerCase() === s.toLowerCase());
  if (lab) return { kind: lab.kind === "token" ? "token" : (lab.kind === "contract" || lab.kind === "relayer" ? "contract" : "address"), value: lab.addr };
  if (/^0x[0-9a-fA-F]+$/.test(s)) return { kind: "address", value: s };
  return { kind: "search", value: s }; // natural language → agent
}

const tools = {
  getChainStatus: () => run("getChainStatus", "eth_blockNumber", () => ({
    chainId: D.CHAIN.chainId, network: D.CHAIN.network, blueScore: D.CHAIN.blueScore,
    height: D.CHAIN.height, gasPriceGwei: D.CHAIN.gasPriceGwei, gasless: true, up: true,
  }), { cache: true }),
  getBlock: (id) => run("getBlock", "eth_getBlockByNumber", () => {
    if (typeof id === "string" && D.blockByHash[id]) return D.blockByHash[id];
    const byH = D.BLOCKS.find((b) => String(b.height) === String(id));
    return byH || D.TIP_BLOCK;
  }),
  getTransaction: (hash) => run("getTransaction", "eth_getTransactionByHash", () => D.TX[hash] || null),
  getAddress: (addr) => run("getAddress", "eth_getBalance", () => D.ADDR[addr] || {
    addr, label: D.labelOf(addr) ? D.labelOf(addr).label : null, isContract: false,
    balanceSalt: "0.00", summary: "This address has no indexed activity yet on the testnet. When it transacts, its history appears here — witnessed, lineage attached.",
    tokens: [], txns: [],
  }, { decoded: false }),
  getLogs: () => run("getLogs", "eth_getLogs", () => true),
  exploreDag: () => run("exploreDag", "citrate_getDagStats", () => ({
    tipsCount: 2, maxBlueScore: D.CHAIN.blueScore, currentTips: D.BLOCKS.filter((b) => b.tips).map((b) => b.hash),
    ghostdagParams: { k: D.CHAIN.k, maxParents: D.CHAIN.maxParents, finalityDepth: D.CHAIN.finalityDepth },
    blocks: D.BLOCKS,
  })),
  topHolders: (token) => run("topHolders", "indexer (DB)", () => (token === "cWETH" ? D.TOKEN[D.L.cweth.addr].holders : D.SALT_HOLDERS), { cache: true }),
  readContract: (addr, fn) => run("readContract", "eth_call", () => {
    const c = D.CONTRACT[(addr || "").toLowerCase()];
    const r = c && c.reads.find((x) => x.fn === fn);
    if (r) return { ...r, decoded: true, verified: true };
    return { fn, result: "0x…", decoded: false, warning: "Unverified — raw read." };
  }),
  getToken: (addr) => run("getToken", "eth_call", () => D.TOKEN[addr] || null),
  isContract: (addr) => run("isContract", "eth_getCode", () => ({ isContract: !!D.CONTRACT[(addr || "").toLowerCase()], known: D.labelOf(addr) ? D.labelOf(addr).label : null })),
};

// finality from depth (A4)
function finality(blueScore) {
  if (blueScore == null) return { state: "pending", depth: 0, threshold: D.CHAIN.finalityDepth };
  const depth = D.CHAIN.blueScore - blueScore;
  return { state: depth >= D.CHAIN.finalityDepth ? "final" : "finalizing", depth, threshold: D.CHAIN.finalityDepth };
}

export const SH = { tools, classify, audit, guard, finality, ALLOWED, FORBIDDEN };
