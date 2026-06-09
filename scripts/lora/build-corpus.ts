/**
 * Citrate-expert LoRA training corpus generator (RA-8).
 *
 * Emits an instruction/chat SFT dataset teaching the base model Citrate's OWN
 * structure — its system contracts (purpose, not just name), precompiles, chain
 * facts (GHOSTDAG, finality-by-depth, native-vs-token), and how to approach
 * hash-free research — so the small model is fluent about THIS chain.
 *
 * Sources are generated from the live contract catalog (RA-5) + curated facts +
 * SYNTHETIC tool-use exemplars (novel entities). The RA-1 golden eval set is a
 * strict HOLDOUT (X-8): this asserts no golden question leaks into the corpus.
 *
 *   npx tsx scripts/lora/build-corpus.ts   → scripts/lora/corpus/citrate-sft.jsonl
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { listContracts, PRECOMPILES, CITRATE_OVERVIEW, CONTRACT_CATEGORIES } from "@/lib/citrate/contractCatalog";
import { parseGoldenJsonl } from "@/lib/eval/golden";

interface Example { messages: { role: "system" | "user" | "assistant"; content: string }[] }

const SYSTEM = "You are CitrateScan's on-chain analyst for the Citrate Network. Be precise and concise; read with tools before stating on-chain facts.";
const ex = (user: string, assistant: string): Example => ({
  messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }, { role: "assistant", content: assistant }],
});

const out: Example[] = [];

// 1. Per-contract knowledge (name + purpose, both name- and address-keyed).
for (const c of listContracts()) {
  out.push(ex(`What is the ${c.name} contract on Citrate?`, `${c.name} (${c.category}) — ${c.purpose} Its address is ${c.address}.`));
  out.push(ex(`What does the contract at ${c.address} do?`, `That's the ${c.name} (${c.category}): ${c.purpose}`));
}

// 2. Per-category listings.
for (const cat of CONTRACT_CATEGORIES) {
  const inCat = listContracts(cat as never);
  if (!inCat.length) continue;
  out.push(ex(`What ${cat} contracts does Citrate have?`, inCat.map((c) => `- ${c.name}: ${c.purpose}`).join("\n")));
}

// 3. Precompiles.
for (const [addr, p] of Object.entries(PRECOMPILES)) {
  out.push(ex(`What is the precompile at ${addr}?`, `${p.name} — ${p.purpose}`));
}

// 4. Curated chain facts.
const FACTS: [string, string][] = [
  ["What chain is Citrate and what's the native token?", "Citrate is chain id 40204. The native token is SALT (18 decimals; 1 SALT = 10^18 grains, the wei-equivalent base unit)."],
  ["What consensus does Citrate use?", "GHOSTDAG — a BlockDAG where multiple blocks (tips) can exist at once and are deterministically ordered by blue_score. There are no orphans."],
  ["Is blue_score the same as block height?", "No. blue_score is the GHOSTDAG consensus ordering and is NOT the same as height. Order by blue_score, not height."],
  ["When is a Citrate block final?", "Finality is by depth in blue_score: a block is final once maxBlueScore − block.blue_score ≥ 100. It is not a fixed confirmation count."],
  ["Is SALT an ERC-20 token?", "No — SALT is the NATIVE coin. It has no ERC-20 Transfer events; native sends live in a transaction's value field. ERC-20/721/1155 tokens are separate contracts with Transfer logs. Never conflate a token amount with native SALT."],
  ["Does Citrate have a native gas paymaster?", "No native paymaster. Gasless writes go through the app-layer EIP-2771 CitrateForwarder relayer."],
  ["What is Citrate in one paragraph?", CITRATE_OVERVIEW],
  ["What's the difference between native SALT and WrappedSALT?", "SALT is the native coin (no contract). WrappedSALT (wSALT) is an ERC-20 wrapper so contracts that need an ERC-20 interface can hold/transfer SALT-equivalent value."],
  ["How do I read a contract's state on Citrate?", "Use callView with the function's Solidity signature, e.g. \"function getModel(bytes32) view returns (address,string,uint256)\". It's read-only."],
  ["What is the inference marketplace?", "ModelRegistry lists AI models; InferenceRouter routes inference requests to registered GPU providers (who stake SALT and register an OpenAI-compatible endpoint) and settles payment."],
];
for (const [q, a] of FACTS) out.push(ex(q, a));

// 5. Tool-use / research approach exemplars (SYNTHETIC entities — not the golden set).
const APPROACH: [string, string][] = [
  ["How would you find a large SALT transfer without knowing the tx hash?", "Use findTransfers with an amount and comparator (e.g. atleast) and an optional time window — no hash needed. The result is NATIVE SALT, so say so, and report the coverage window honestly."],
  ["Someone asks for the biggest token transfers of a specific ERC-20 last week. How?", "Call findTransfers with that token's address and since='last week', order='biggest'. Amounts are in the token's units; label the result with the token's symbol — don't conflate with native SALT."],
  ["How do you answer 'who holds the most SALT'?", "Use saltDistribution — SALT is native (no Transfer events), so it returns known genesis holders with live balances and notes a full leaderboard needs a balance indexer. Don't use topHolders for SALT."],
  ["How do you explain a transaction?", "getTransaction (and explainTransaction for decoded transfers), then a short narrative — who did what, value moved, protocol touched, gas, success/failure — above the raw data."],
  ["A user asks what a contract is. What do you do?", "describeContract(address) for its purpose/category; getContractCode for deployment facts; if it's a token, getToken. Confirm it's deployed with getAddress."],
  ["You found nothing in the indexed window. What do you say?", "Say so plainly — the match may be outside the coverage window — rather than implying none exist. Offer to widen the window or use a live scan."],
];
for (const [q, a] of APPROACH) out.push(ex(q, a));

// --- holdout (X-8): FILTER OUT any example colliding with a golden eval question,
// so the golden set stays a true holdout by construction. ---
const goldenPath = resolve(process.cwd(), "scripts/eval/golden/citrate.golden.jsonl");
let held = 0;
let corpus = out;
if (existsSync(goldenPath)) {
  const golden = new Set(parseGoldenJsonl(readFileSync(goldenPath, "utf8")).map((g) => g.question.trim().toLowerCase()));
  corpus = out.filter((e) => {
    const collides = golden.has(e.messages[1].content.trim().toLowerCase());
    if (collides) held++;
    return !collides;
  });
}

const dir = resolve(process.cwd(), "scripts/lora/corpus");
mkdirSync(dir, { recursive: true });
const path = resolve(dir, "citrate-sft.jsonl");
writeFileSync(path, corpus.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`wrote ${corpus.length} SFT examples → ${path}`);
console.log(`held out ${held} example(s) that collided with the golden eval set (X-8).`);
