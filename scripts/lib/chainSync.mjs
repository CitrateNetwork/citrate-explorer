/**
 * Pure helpers for `scripts/sync-addresses.mjs`: turn citrate-chain sources into the explorer's
 * generated 40204 chain constants (`src/generated/chainConstants.json`). No I/O here, so the
 * parsers and the fail-closed rules are unit-tested (src/lib/citrate/chainSync.test.ts).
 *
 * Inputs (all from one citrate-chain checkout):
 *   - contracts/addresses/40204.json            the address book (its `precompiles` section)
 *   - core/execution/src/precompiles/mod.rs     PURE_PRECOMPILE_ADDRESSES + AGENT_FORK_PRECOMPILE_ADDRESSES
 *   - core/economics/src/genesis.rs             GenesisConfig::testnet_beta (the 40204 genesis accounts)
 */

const PRECOMPILE_TABLES = [
  ["PURE_PRECOMPILE_ADDRESSES", "pure"],
  ["AGENT_FORK_PRECOMPILE_ADDRESSES", "agent"],
];

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** A short precompile id like "0x0112" as a 20-byte lowercase address. */
function shortToAddress(short) {
  const hex = short.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{1,40}$/.test(hex)) throw new Error(`bad precompile address ${short}`);
  return `0x${hex.padStart(40, "0")}`;
}

/** SCREAMING_SNAKE to PascalCase: LORA_APPLY -> LoraApply. */
export function pascalFromConst(name) {
  return name
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

/**
 * Read both precompile address tables from mod.rs. Each element line is
 * `path::CONST_NAME, // 0xNNNN ...`; the address comes from the comment, the name from the element.
 * Fails if a table is missing, a line does not parse, or the count disagrees with the declared size.
 */
export function parsePrecompileTables(rs) {
  const out = [];
  for (const [table, kind] of PRECOMPILE_TABLES) {
    const head = new RegExp(`pub const ${table}: \\[\\[u8; 20\\]; (\\d+)\\] = \\[([\\s\\S]*?)\\n\\];`);
    const m = rs.match(head);
    if (!m) throw new Error(`precompiles: ${table} not found in mod.rs`);
    const declared = Number(m[1]);
    const rows = m[2].split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
    for (const row of rows) {
      const r = row.match(/^([A-Za-z0-9_:]+),\s*\/\/\s*(0x[0-9A-Fa-f]+)\b/);
      if (!r) throw new Error(`precompiles: cannot parse ${table} element: ${row}`);
      const constName = r[1].split("::").pop();
      out.push({ address: shortToAddress(r[2]), constName, table: kind });
    }
    const found = out.filter((e) => e.table === kind).length;
    if (found !== declared) throw new Error(`precompiles: ${table} declares ${declared} entries but lists ${found}`);
  }
  return out;
}

function bodyOfFn(rs, name) {
  const start = rs.search(new RegExp(`fn ${name}\\s*\\(`));
  if (start < 0) return null;
  const open = rs.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < rs.length; i++) {
    if (rs[i] === "{") depth++;
    else if (rs[i] === "}" && --depth === 0) return rs.slice(open + 1, i);
  }
  return null;
}

function resolveAddressConst(rs, name) {
  const m = rs.match(new RegExp(`pub const ${name}: Address = Address\\(\\[([^\\]]*)\\]\\);`));
  if (!m) throw new Error(`genesis: address constant ${name} not found`);
  const inner = m[1].replace(/\/\/[^\n]*/g, "").trim();
  const rep = inner.match(/^(0x[0-9a-fA-F]{1,2})\s*;\s*20$/);
  const bytes = rep ? Array(20).fill(rep[1]) : inner.split(",").map((b) => b.trim()).filter(Boolean);
  if (bytes.length !== 20) throw new Error(`genesis: ${name} has ${bytes.length} bytes, expected 20`);
  return `0x${bytes.map((b) => Number.parseInt(b, 16).toString(16).padStart(2, "0")).join("")}`;
}

function resolveAmount(rs, token) {
  if (/^[0-9_]+$/.test(token)) return BigInt(token.replace(/_/g, "")).toString();
  const m = rs.match(new RegExp(`pub const ${token}: u64 = ([0-9_]+);`));
  if (!m) throw new Error(`genesis: amount constant ${token} not found`);
  return BigInt(m[1].replace(/_/g, "")).toString();
}

/**
 * The funded accounts of `GenesisConfig::testnet_beta` (chain 40204): every
 * `account(CONST, AMOUNT)` call, with CONST resolved to its byte-array address and AMOUNT (whole
 * SALT) resolved from a literal or a `u64` constant. Zero-balance system accounts built by helper
 * functions (the CREATE2 factory) are not SALT holders and are already in the book's `genesis`.
 */
export function parseGenesisAllocations(rs) {
  const body = bodyOfFn(rs, "testnet_beta");
  if (body === null) throw new Error("genesis: fn testnet_beta not found in genesis.rs");
  const out = [];
  for (const m of body.matchAll(/^\s*account\(\s*([A-Z0-9_]+)\s*,\s*([A-Z0-9_]+)\s*\)/gm)) {
    out.push({ constName: m[1], address: resolveAddressConst(rs, m[1]), genesisSalt: resolveAmount(rs, m[2]) });
  }
  if (out.length === 0) throw new Error("genesis: testnet_beta lists no account(...) entries");
  return out;
}

/**
 * Merge the book's precompiles with the chain tables (by address; a book name wins, else the
 * chain constant in PascalCase), attach descriptions and genesis labels, and fail closed on any
 * precompile without a description or genesis account without a label.
 */
export function buildChainConstants({ book, precompileRs, genesisRs, descriptions, genesisLabels }) {
  if (book?.chainId !== 40204) throw new Error(`book chainId is ${book?.chainId}, expected 40204`);
  const byAddr = new Map();
  for (const [name, a] of Object.entries(book.precompiles ?? {})) {
    if (typeof a !== "string" || !ADDRESS_RE.test(a)) throw new Error(`book precompile ${name} is not a 20-byte hex: ${a}`);
    byAddr.set(a.toLowerCase(), { name, sources: ["book"] });
  }
  for (const e of parsePrecompileTables(precompileRs)) {
    const hit = byAddr.get(e.address);
    if (hit) hit.sources.push(`chain:${e.table}`);
    else byAddr.set(e.address, { name: pascalFromConst(e.constName), sources: [`chain:${e.table}`] });
  }
  const missing = [];
  const precompiles = [...byAddr.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([address, v]) => {
      const purpose = descriptions[v.name];
      if (!purpose) missing.push(`${v.name} (${address})`);
      return { address, name: v.name, purpose: purpose ?? "", sources: v.sources };
    });
  if (missing.length) throw new Error(`no catalog description for precompile(s): ${missing.join(", ")}`);

  const unlabeled = [];
  const genesisAllocations = parseGenesisAllocations(genesisRs).map((g) => {
    const label = genesisLabels[g.constName];
    if (!label) unlabeled.push(g.constName);
    return { address: g.address, label: label ?? "", genesisSalt: g.genesisSalt };
  });
  if (unlabeled.length) throw new Error(`no label for genesis account(s): ${unlabeled.join(", ")}`);
  return { precompiles, genesisAllocations };
}

/** Stable JSON for the committed file (with a do-not-edit header), newline-terminated. */
export function serializeChainConstants(constants) {
  return (
    JSON.stringify(
      {
        $comment:
          "GENERATED by `pnpm sync-addresses` from citrate-chain (contracts/addresses/40204.json, " +
          "core/execution/src/precompiles/mod.rs, core/economics/src/genesis.rs). Do not edit by hand.",
        chainId: 40204,
        precompiles: constants.precompiles,
        genesisAllocations: constants.genesisAllocations,
      },
      null,
      2,
    ) + "\n"
  );
}
