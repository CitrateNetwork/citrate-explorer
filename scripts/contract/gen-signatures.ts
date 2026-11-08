/**
 * Writes src/generated/signatures.json, the bundled signature subset the contract
 * pages use for unverified code (EXP-S3), from the explorer's known ABIs plus the
 * curated standard set (src/lib/contract/standardSignatures.ts).
 *
 *   pnpm contract:signatures           write the file
 *   pnpm contract:signatures --check   exit 1 if the committed file is stale
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSignatureDb, serializeSignatureDb } from "../../src/lib/contract/signatures";
import { knownAbiItems } from "../../src/lib/contract/signatureSources";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/generated/signatures.json");
const text = serializeSignatureDb(buildSignatureDb(knownAbiItems()));

if (process.argv.includes("--check")) {
  const cur = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (cur !== text) {
    console.error("src/generated/signatures.json is stale: run pnpm contract:signatures");
    process.exit(1);
  }
  console.log("signatures.json is in sync");
} else {
  writeFileSync(out, text);
  const db = JSON.parse(text);
  console.log(
    `wrote signatures.json: ${Object.keys(db.functions).length} functions, ${Object.keys(db.events).length} events, ${Object.keys(db.errors).length} errors`,
  );
}
