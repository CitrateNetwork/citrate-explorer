#!/usr/bin/env node
/**
 * Sync the canonical Citrate contract-address table from citrate-chain into
 * this repo's committed vendored copies:
 *   src/generated/addresses.json            <- contracts/addresses/40204.json
 *   src/generated/addresses.provenance.json <- contracts/addresses/40204.provenance.json
 *
 * The provenance file is the on-chain deployer-tx ledger (tx hash, block, CREATE
 * vs CREATE2, canonical vs orphan). The contract index uses it to fill
 * `contracts.creation_tx` / `creator` for book entries (src/lib/indexer/contractLabels.ts).
 * The explorer never reads the sibling checkout at runtime: only these copies.
 *
 * Source-of-truth lives in citrate-chain (sibling of this repo under
 * Citrate-Labs/, or wherever CITRATE_CHAIN_DIR points).
 *
 * Run via `pnpm sync-addresses`. With `--check` (CI gate) it exits non-zero if
 * either vendored copy differs from the canonical. Without `--check`, it
 * overwrites both and prints what changed.
 *
 *   CITRATE_CHAIN_DIR=/path/to/citrate-chain pnpm sync-addresses
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
// citrate-chain is a sibling of citrate-explorer under Citrate-Labs/ unless
// CITRATE_CHAIN_DIR says otherwise. VENDORED_DIR override exists for the test.
const CHAIN_DIR = process.env.CITRATE_CHAIN_DIR
  ? resolve(process.env.CITRATE_CHAIN_DIR)
  : resolve(REPO_ROOT, "..", "citrate-chain");
const CANONICAL = resolve(CHAIN_DIR, "contracts", "addresses", "40204.json");
const CANONICAL_PROVENANCE = resolve(
  CHAIN_DIR,
  "contracts",
  "addresses",
  "40204.provenance.json",
);
const VENDORED_DIR = process.env.VENDORED_DIR
  ? resolve(process.env.VENDORED_DIR)
  : resolve(REPO_ROOT, "src", "generated");
const VENDORED = resolve(VENDORED_DIR, "addresses.json");
const VENDORED_PROVENANCE = resolve(VENDORED_DIR, "addresses.provenance.json");

const CHECK_MODE = process.argv.includes("--check");

if (!existsSync(CANONICAL)) {
  console.error(
    `[sync-addresses] canonical not found at ${CANONICAL}\n` +
      "  Make sure citrate-chain is a sibling of this repo under Citrate-Labs/, or set CITRATE_CHAIN_DIR.",
  );
  process.exit(1);
}
if (!existsSync(CANONICAL_PROVENANCE)) {
  console.error(`[sync-addresses] canonical provenance not found at ${CANONICAL_PROVENANCE}`);
  process.exit(1);
}

const canonical = JSON.parse(readFileSync(CANONICAL, "utf8"));

// Minimum-shape gate: a malformed canonical must NOT pollute the vendored
// copy. Reject anything missing `chainId`, `contracts`, or `aaStack`.
const requiredTop = ["chainId", "contracts", "aaStack"];
for (const k of requiredTop) {
  if (!(k in canonical)) {
    console.error(`[sync-addresses] canonical is missing required key: ${k}`);
    process.exit(1);
  }
}
if (canonical.chainId !== 40204) {
  console.error(
    `[sync-addresses] canonical chainId is ${canonical.chainId}, expected 40204`,
  );
  process.exit(1);
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const allAddresses = [
  ...Object.entries(canonical.contracts ?? {}),
  ...Object.entries(canonical.aaStack ?? {}),
  ...Object.entries(canonical.genesis ?? {}),
];
for (const [name, addr] of allAddresses) {
  if (typeof addr !== "string" || !ADDRESS_RE.test(addr)) {
    console.error(
      `[sync-addresses] address for ${name} is not a 20-byte hex: ${addr}`,
    );
    process.exit(1);
  }
}

const provenance = JSON.parse(readFileSync(CANONICAL_PROVENANCE, "utf8"));
if (provenance.chainId !== 40204 || !Array.isArray(provenance.ledger)) {
  console.error("[sync-addresses] canonical provenance must have chainId 40204 and a ledger[]");
  process.exit(1);
}
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
for (const e of provenance.ledger) {
  if (e.kind !== "CREATE" && e.kind !== "CREATE2") continue;
  if (!TX_RE.test(e.tx ?? "") || !ADDRESS_RE.test(e.address ?? "")) {
    console.error(`[sync-addresses] provenance entry nonce=${e.nonce} has a malformed tx/address`);
    process.exit(1);
  }
}

const serialized = JSON.stringify(canonical, null, 2) + "\n";
const serializedProvenance = JSON.stringify(provenance, null, 2) + "\n";

if (CHECK_MODE) {
  for (const [path, want] of [
    [VENDORED, serialized],
    [VENDORED_PROVENANCE, serializedProvenance],
  ]) {
    if (!existsSync(path)) {
      console.error(`[sync-addresses] no vendored copy at ${path}`);
      process.exit(1);
    }
    if (readFileSync(path, "utf8") !== want) {
      console.error(
        `[sync-addresses] ${path} is OUT OF SYNC with canonical. Run \`pnpm sync-addresses\` and commit the diff.`,
      );
      process.exit(1);
    }
  }
  console.log("[sync-addresses] vendored copies match canonical ✓");
  process.exit(0);
}

writeFileSync(VENDORED, serialized);
writeFileSync(VENDORED_PROVENANCE, serializedProvenance);
console.log(`[sync-addresses] wrote ${VENDORED}`);
console.log(`[sync-addresses] wrote ${VENDORED_PROVENANCE} (${provenance.ledger.length} ledger entries)`);
console.log(
  `  contracts: ${Object.keys(canonical.contracts ?? {}).length}` +
    `, aaStack: ${Object.keys(canonical.aaStack ?? {}).length}` +
    `, genesis: ${Object.keys(canonical.genesis ?? {}).length}`,
);
