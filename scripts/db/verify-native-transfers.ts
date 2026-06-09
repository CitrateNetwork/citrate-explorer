/**
 * Dev verification for findNativeTransfers (RA-2) against a real Neon DB.
 * Read-only. Requires DATABASE_URL in the environment.
 *
 *   DATABASE_URL="postgres://…" npx tsx scripts/db/verify-native-transfers.ts
 */
import { findNativeTransfers } from "@/lib/indexer/repository";
import { resolveAmount, amountRange } from "@/lib/research/resolvers";

const log = (...a: unknown[]) => console.log(...a);

async function show(label: string, q: Parameters<typeof findNativeTransfers>[0]) {
  const r = await findNativeTransfers(q);
  if (!("provisioned" in r) || !r.provisioned) {
    log(`\n## ${label}: NOT PROVISIONED (no DATABASE_URL)`);
    return;
  }
  log(`\n## ${label}`);
  log(`   coverage: blocks ${r.coverage.minHeight}–${r.coverage.maxHeight}, ts ${r.coverage.minTimestamp}–${r.coverage.maxTimestamp}`);
  log(`   count=${r.count} truncated=${r.truncated} asset=${r.asset}`);
  for (const t of r.transfers.slice(0, 5)) {
    log(`   ${t.salt} SALT  blk ${t.blockHeight}  ${t.from} -> ${t.to}  ${t.hash.slice(0, 12)}…`);
  }
}

async function main() {
  await show("biggest 5 native transfers (all time)", { order: "value_desc", limit: 5 });
  await show("most recent 5", { order: "time_desc", limit: 5 });

  const a = resolveAmount("30k SALT");
  if (a.ok) await show("~30,000 SALT (about ±1%)", { ...amountRange(a.grains, "about"), limit: 5 });

  const b = resolveAmount("10k SALT");
  if (b.ok)
    await show("treasury sent ≥ 10k SALT", {
      ...amountRange(b.grains, "atleast"),
      counterparty: "0xaceaa7d00c024d32e6e0a07094ceb1a7706786d1",
      direction: "sent",
      limit: 5,
    });
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
