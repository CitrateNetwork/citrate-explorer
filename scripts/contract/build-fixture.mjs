#!/usr/bin/env node
/**
 * Compiles the contract-page test fixture (src/lib/contract/__fixtures__/registry)
 * with the bundled solc-js and writes registry.json: the standard-JSON input, ABI,
 * runtime bytecode, deployedSourceMap and the source ids solc assigned.
 *
 * The tests read the committed JSON, so they never compile. Re-run after editing the
 * fixture sources:  node scripts/contract/build-fixture.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const solc = require("solc");
const root = new URL("../../src/lib/contract/__fixtures__/registry/", import.meta.url).pathname;

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".sol") ? [p] : [];
  });
}

const sources = {};
for (const p of walk(join(root, "src")).sort()) sources[relative(root, p)] = { content: readFileSync(p, "utf8") };

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object", "evm.deployedBytecode.sourceMap", "evm.deployedBytecode.immutableReferences"], "": ["ast"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}
const c = out.contracts["src/Registry.sol"].Registry;
const sourceIds = Object.fromEntries(Object.entries(out.sources).map(([k, v]) => [k, v.id]));
const fixture = {
  compiler: `v${solc.version()}`,
  contractName: "Registry",
  fullyQualifiedName: "src/Registry.sol:Registry",
  stdJsonInput: input,
  sourceIds,
  abi: c.abi,
  runtimeBytecode: "0x" + c.evm.deployedBytecode.object,
  deployedSourceMap: c.evm.deployedBytecode.sourceMap,
};
writeFileSync(join(root, "..", "registry.json"), JSON.stringify(fixture, null, 1) + "\n");
console.log(`wrote registry.json (${c.evm.deployedBytecode.object.length / 2} runtime bytes, ${Object.keys(sources).length} sources)`);
