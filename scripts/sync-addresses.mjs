#!/usr/bin/env node
/**
 * Sync the explorer's 40204 chain data from one citrate-chain checkout, for each network the
 * explorer can be built for. r1005 and r1006 share chain id 40204; NEXT_PUBLIC_CITRATE_NETWORK
 * picks one at build time (src/lib/citrate/network.ts). Two generated files per network:
 *
 *   r1005 (live until the r1006 cutover)          r1006
 *   src/generated/addresses.json                  src/generated/r1006/addresses.json
 *   src/generated/chainConstants.json             src/generated/r1006/chainConstants.json
 *
 *   addresses.json       verbatim copy of the network's book (contracts/addresses/40204.json for
 *                        r1005, contracts/addresses/r1006/40204.json for r1006)
 *   chainConstants.json  network name + block-0 hash (core/consensus/src/hardening.rs), the
 *                        precompile catalog (the book's `precompiles` + core/execution/src/precompiles/mod.rs)
 *                        and the genesis SALT allocations (r1005: core/economics/src/genesis.rs
 *                        testnet_beta; r1006: core/economics/assets/r1006/alloc.json)
 *
 * Usage:
 *   pnpm sync-addresses [--chain <citrate-chain dir>] [--book r1005|r1006|all] [--only book|constants] [--check]
 *
 *   --chain   the citrate-chain checkout (default: ../citrate-chain, or CITRATE_CHAIN_DIR)
 *   --book    which network's files to sync (default: all, or CITRATE_ADDRESS_BOOK)
 *   --only    sync just one output (default: both)
 *   --check   write nothing; exit 1 if a committed file differs from what the inputs generate
 *
 * Fails closed: a malformed book, an unparsable chain source, a missing genesis pin, a placeholder
 * r1006 allocation, a chain precompile with no catalog description, or a genesis account with no
 * label (scripts/lib/chainLabels.mjs) is an error, and nothing is written.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChainConstants, serializeChainConstants, NETWORKS } from "./lib/chainSync.mjs";
import { PRECOMPILE_DESCRIPTIONS, GENESIS_LABELS, R1006_ROLE_LABELS } from "./lib/chainLabels.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const CHECK_MODE = args.includes("--check");
const ONLY = argValue("--only");
if (ONLY !== undefined && ONLY !== "book" && ONLY !== "constants") {
  console.error("[sync-addresses] --only takes `book` or `constants`");
  process.exit(2);
}
const BOOK_ARG = argValue("--book") ?? process.env.CITRATE_ADDRESS_BOOK ?? "all";
if (BOOK_ARG !== "all" && !(BOOK_ARG in NETWORKS)) {
  console.error(`[sync-addresses] --book takes ${Object.keys(NETWORKS).join(", ")} or all`);
  process.exit(2);
}
const SELECTED = BOOK_ARG === "all" ? Object.keys(NETWORKS) : [BOOK_ARG];
const CHAIN = resolve(argValue("--chain") ?? process.env.CITRATE_CHAIN_DIR ?? resolve(REPO_ROOT, "..", "citrate-chain"));

/** Where each network's generated files live. r1005 keeps the original paths. */
const OUT_DIR = {
  r1005: resolve(REPO_ROOT, "src", "generated"),
  r1006: resolve(REPO_ROOT, "src", "generated", "r1006"),
};

const SHARED_INPUTS = {
  precompiles: resolve(CHAIN, "core", "execution", "src", "precompiles", "mod.rs"),
  hardening: resolve(CHAIN, "core", "consensus", "src", "hardening.rs"),
  genesis: resolve(CHAIN, "core", "economics", "src", "genesis.rs"),
  r1006Alloc: resolve(CHAIN, "core", "economics", "assets", "r1006", "alloc.json"),
};

const fail = (msg) => {
  console.error(`[sync-addresses] ${msg}`);
  process.exit(1);
};
const read = (p) => {
  if (!existsSync(p)) fail(`input not found: ${p}\n  Pass --chain <citrate-chain checkout> (or set CITRATE_CHAIN_DIR).`);
  return readFileSync(p, "utf8");
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Generate { book?, constants? } text for one network. */
function generate(network) {
  const canonical = JSON.parse(read(resolve(CHAIN, NETWORKS[network].book)));

  // Minimum-shape gate: a malformed book must NOT pollute the vendored copy.
  for (const k of ["chainId", "contracts", "aaStack"]) {
    if (!(k in canonical)) fail(`${network} book is missing required key: ${k}`);
  }
  if (canonical.chainId !== 40204) fail(`${network} book chainId is ${canonical.chainId}, expected 40204`);
  for (const [name, addr] of [
    ...Object.entries(canonical.contracts ?? {}),
    ...Object.entries(canonical.aaStack ?? {}),
    ...Object.entries(canonical.genesis ?? {}),
    ...Object.entries(canonical.precompiles ?? {}),
  ]) {
    if (typeof addr !== "string" || !ADDRESS_RE.test(addr)) fail(`${network}: address for ${name} is not a 20-byte hex: ${addr}`);
  }

  const out = {};
  if (ONLY !== "constants") out.book = JSON.stringify(canonical, null, 2) + "\n";
  if (ONLY !== "book") {
    const fromAlloc = NETWORKS[network].allocations === "allocJson";
    try {
      out.constants = serializeChainConstants(
        buildChainConstants({
          network,
          book: canonical,
          precompileRs: read(SHARED_INPUTS.precompiles),
          hardeningRs: read(SHARED_INPUTS.hardening),
          genesisRs: fromAlloc ? undefined : read(SHARED_INPUTS.genesis),
          genesisLabels: GENESIS_LABELS,
          allocJson: fromAlloc ? JSON.parse(read(SHARED_INPUTS.r1006Alloc)) : undefined,
          roleLabels: R1006_ROLE_LABELS,
          descriptions: PRECOMPILE_DESCRIPTIONS,
        }),
      );
    } catch (err) {
      fail(`${network}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

// Generate everything first so a failure in any network writes nothing.
const plan = [];
for (const network of SELECTED) {
  const out = generate(network);
  for (const [k, text] of Object.entries(out)) {
    const file = resolve(OUT_DIR[network], k === "book" ? "addresses.json" : "chainConstants.json");
    plan.push({ network, k, file, text });
  }
}

if (CHECK_MODE) {
  let drift = false;
  for (const { network, k, file, text } of plan) {
    const committed = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (committed !== text) {
      drift = true;
      console.error(`[sync-addresses] ${network} ${k}: ${file} is OUT OF SYNC with ${CHAIN}.`);
    } else {
      console.log(`[sync-addresses] ${network} ${k}: matches ${CHAIN}`);
    }
  }
  if (drift) fail("run `pnpm sync-addresses --chain <citrate-chain>` and commit the diff.");
  process.exit(0);
}

for (const { network, k, file, text } of plan) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`[sync-addresses] ${network}: wrote ${file}`);
  if (k === "constants") {
    const c = JSON.parse(text);
    console.log(`  genesis ${c.genesisHash}; precompiles: ${c.precompiles.length}, genesis allocations: ${c.genesisAllocations.length}`);
  }
}
