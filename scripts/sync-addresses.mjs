#!/usr/bin/env node
/**
 * Sync the explorer's 40204 chain data from one citrate-chain checkout. Two generated files:
 *
 *   src/generated/addresses.json       verbatim copy of contracts/addresses/40204.json (the book)
 *   src/generated/chainConstants.json  precompile catalog + genesis SALT allocations, built from
 *                                      the book's `precompiles`, core/execution/src/precompiles/mod.rs
 *                                      (PURE_PRECOMPILE_ADDRESSES, AGENT_FORK_PRECOMPILE_ADDRESSES)
 *                                      and core/economics/src/genesis.rs (testnet_beta)
 *
 * Usage:
 *   pnpm sync-addresses [--chain <citrate-chain dir>] [--only book|constants] [--check]
 *
 *   --chain   the citrate-chain checkout (default: ../citrate-chain, or CITRATE_CHAIN_DIR)
 *   --only    sync just one output (default: both)
 *   --check   write nothing; exit 1 if a committed file differs from what the inputs generate
 *
 * Fails closed: a malformed book, an unparsable chain source, a chain precompile with no catalog
 * description, or a genesis account with no label (scripts/lib/chainLabels.mjs) is an error, and
 * nothing is written.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChainConstants, serializeChainConstants } from "./lib/chainSync.mjs";
import { PRECOMPILE_DESCRIPTIONS, GENESIS_LABELS } from "./lib/chainLabels.mjs";

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
const CHAIN = resolve(argValue("--chain") ?? process.env.CITRATE_CHAIN_DIR ?? resolve(REPO_ROOT, "..", "citrate-chain"));

const INPUTS = {
  book: resolve(CHAIN, "contracts", "addresses", "40204.json"),
  precompiles: resolve(CHAIN, "core", "execution", "src", "precompiles", "mod.rs"),
  genesis: resolve(CHAIN, "core", "economics", "src", "genesis.rs"),
};
const OUTPUTS = {
  book: resolve(REPO_ROOT, "src", "generated", "addresses.json"),
  constants: resolve(REPO_ROOT, "src", "generated", "chainConstants.json"),
};

const fail = (msg) => {
  console.error(`[sync-addresses] ${msg}`);
  process.exit(1);
};
const read = (p) => {
  if (!existsSync(p)) fail(`input not found: ${p}\n  Pass --chain <citrate-chain checkout> (or set CITRATE_CHAIN_DIR).`);
  return readFileSync(p, "utf8");
};

const canonical = JSON.parse(read(INPUTS.book));

// Minimum-shape gate: a malformed book must NOT pollute the vendored copy.
for (const k of ["chainId", "contracts", "aaStack"]) {
  if (!(k in canonical)) fail(`canonical is missing required key: ${k}`);
}
if (canonical.chainId !== 40204) fail(`canonical chainId is ${canonical.chainId}, expected 40204`);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
for (const [name, addr] of [
  ...Object.entries(canonical.contracts ?? {}),
  ...Object.entries(canonical.aaStack ?? {}),
  ...Object.entries(canonical.genesis ?? {}),
  ...Object.entries(canonical.precompiles ?? {}),
]) {
  if (typeof addr !== "string" || !ADDRESS_RE.test(addr)) fail(`address for ${name} is not a 20-byte hex: ${addr}`);
}

const outputs = {};
if (ONLY !== "constants") outputs.book = JSON.stringify(canonical, null, 2) + "\n";
if (ONLY !== "book") {
  try {
    outputs.constants = serializeChainConstants(
      buildChainConstants({
        book: canonical,
        precompileRs: read(INPUTS.precompiles),
        genesisRs: read(INPUTS.genesis),
        descriptions: PRECOMPILE_DESCRIPTIONS,
        genesisLabels: GENESIS_LABELS,
      }),
    );
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

if (CHECK_MODE) {
  let drift = false;
  for (const [k, text] of Object.entries(outputs)) {
    const committed = existsSync(OUTPUTS[k]) ? readFileSync(OUTPUTS[k], "utf8") : null;
    if (committed !== text) {
      drift = true;
      console.error(`[sync-addresses] ${OUTPUTS[k]} is OUT OF SYNC with ${CHAIN}.`);
    } else {
      console.log(`[sync-addresses] ${k}: matches ${CHAIN}`);
    }
  }
  if (drift) fail("run `pnpm sync-addresses --chain <citrate-chain>` and commit the diff.");
  process.exit(0);
}

for (const [k, text] of Object.entries(outputs)) {
  writeFileSync(OUTPUTS[k], text);
  console.log(`[sync-addresses] wrote ${OUTPUTS[k]}`);
}
if (outputs.constants) {
  const c = JSON.parse(outputs.constants);
  console.log(`  precompiles: ${c.precompiles.length}, genesis allocations: ${c.genesisAllocations.length}`);
}
