/**
 * Pure helpers for `scripts/sync-addresses.mjs`: turn citrate-chain sources into the explorer's
 * generated 40204 chain constants (`src/generated/chainConstants.json`). No I/O here, so the
 * parsers and the fail-closed rules are unit-tested (src/lib/citrate/chainSync.test.ts).
 *
 * Inputs (all from one citrate-chain checkout), per network (r1005 and r1006 share chain id 40204):
 *   - the address book: contracts/addresses/40204.json (r1005) or contracts/addresses/r1006/40204.json
 *   - core/execution/src/precompiles/mod.rs     PURE_PRECOMPILE_ADDRESSES + AGENT_FORK_PRECOMPILE_ADDRESSES
 *   - core/consensus/src/hardening.rs           the network's block-0 hash (RELEASE_GENESIS / R1006_GENESIS)
 *   - genesis SALT: core/economics/src/genesis.rs GenesisConfig::testnet_beta (r1005), or
 *                   core/economics/assets/r1006/alloc.json, the ceremony allocation (r1006)
 */

/** The 40204 networks the explorer can be built for, and where each one's inputs live. */
export const NETWORKS = {
  r1005: {
    book: "contracts/addresses/40204.json",
    allocations: "genesisRs",
  },
  r1006: {
    book: "contracts/addresses/r1006/40204.json",
    allocations: "allocJson",
  },
};

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

const HASH_RE = /^0x[0-9a-f]{64}$/;

/**
 * The network's block-0 hash from citrate-chain `core/consensus/src/hardening.rs`: r1005 is the
 * `RELEASE_GENESIS` entry under the `// testnet_beta` comment, r1006 is `R1006_GENESIS`.
 */
export function parseReleaseGenesis(rs, network) {
  let m;
  if (network === "r1005") {
    m = rs.match(/\/\/ testnet_beta\b[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*\(\s*40204\s*,\s*hex32\("([0-9a-fA-F]{64})"\)/);
    if (!m) throw new Error("genesis hash: the testnet_beta (r1005) RELEASE_GENESIS entry was not found in hardening.rs");
  } else if (network === "r1006") {
    m = rs.match(/pub const R1006_GENESIS: \[u8; 32\] =\s*hex32\("([0-9a-fA-F]{64})"\)/);
    if (!m) throw new Error("genesis hash: R1006_GENESIS was not found in hardening.rs");
  } else {
    throw new Error(`genesis hash: unknown network ${network}`);
  }
  return `0x${m[1].toLowerCase()}`;
}

const WEI_PER_SALT = 10n ** 18n;

function wholeSalt(hexWei, who) {
  let wei;
  try {
    wei = BigInt(hexWei);
  } catch {
    throw new Error(`r1006 alloc: balance of ${who} is not a number: ${hexWei}`);
  }
  if (wei % WEI_PER_SALT !== 0n) throw new Error(`r1006 alloc: balance of ${who} is not a whole SALT amount: ${hexWei}`);
  return (wei / WEI_PER_SALT).toString();
}

/**
 * The genesis SALT allocations of r1006, from the ceremony allocation
 * (`core/economics/assets/r1006/alloc.json`) the node builds block 0 from
 * (citrate-chain core/economics/src/r1006.rs): the base allocations (labelled by role), then every
 * funded ceremony account (labelled by its name in the r1006 book). A base allocation whose address
 * is also a ceremony account is replaced by that account, as the node does. Whole SALT, like the
 * r1005 list. Fails closed on placeholder inputs (a rehearsal allocation) and on any unlabelled entry.
 */
export function parseR1006Allocations(alloc, book, roleLabels) {
  if (alloc?.format !== "citrate-genesis-alloc-v1") throw new Error(`r1006 alloc: unknown format ${alloc?.format}`);
  if (alloc.profile !== "r1006") throw new Error(`r1006 alloc: profile is ${alloc.profile}, expected r1006`);
  if (alloc.inputsStatus !== "final" || !Array.isArray(alloc.baseAllocations)) {
    throw new Error(`r1006 alloc: inputs are placeholders (inputsStatus=${alloc.inputsStatus}); a rehearsal allocation is not r1006's genesis`);
  }
  if (!Array.isArray(alloc.accounts)) throw new Error("r1006 alloc: no accounts list");
  const names = new Map();
  for (const section of ["contracts", "aaStack", "genesis"]) {
    for (const [name, a] of Object.entries(book?.[section] ?? {})) {
      if (typeof a === "string") names.set(a.toLowerCase(), name);
    }
  }
  const accountAddrs = new Set(alloc.accounts.map((a) => String(a.address).toLowerCase()));
  const out = [];
  const unlabeled = [];
  const roleByAddr = new Map();
  for (const b of alloc.baseAllocations) {
    const address = String(b.address).toLowerCase();
    if (!ADDRESS_RE.test(address)) throw new Error(`r1006 alloc: base allocation ${b.role} is not a 20-byte hex: ${b.address}`);
    const label = roleLabels[b.role];
    if (!label) unlabeled.push(`role ${b.role}`);
    roleByAddr.set(address, label);
    if (accountAddrs.has(address)) continue;
    out.push({ address, label: label ?? "", genesisSalt: wholeSalt(b.balance, address) });
  }
  for (const a of alloc.accounts) {
    const address = String(a.address).toLowerCase();
    if (!ADDRESS_RE.test(address)) throw new Error(`r1006 alloc: account is not a 20-byte hex: ${a.address}`);
    const salt = wholeSalt(a.balance, address);
    if (salt === "0") continue;
    const label = names.get(address) ?? roleByAddr.get(address);
    if (!label) unlabeled.push(address);
    out.push({ address, label: label ?? "", genesisSalt: salt });
  }
  if (unlabeled.length) throw new Error(`no label for r1006 genesis allocation(s): ${unlabeled.join(", ")}`);
  if (out.length === 0) throw new Error("r1006 alloc: no funded accounts");
  return out;
}

/**
 * Merge the book's precompiles with the chain tables (by address; a book name wins, else the
 * chain constant in PascalCase), attach descriptions and genesis labels, and fail closed on any
 * precompile without a description or genesis account without a label.
 *
 * @param {{
 *   network?: string, book: any, precompileRs: string, hardeningRs: string,
 *   genesisRs?: string, genesisLabels?: Record<string, string>,
 *   allocJson?: any, roleLabels?: Record<string, string>, descriptions: Record<string, string>
 * }} inputs
 */
export function buildChainConstants({
  network = "r1005",
  book,
  precompileRs,
  hardeningRs,
  genesisRs,
  genesisLabels,
  allocJson,
  roleLabels,
  descriptions,
}) {
  if (!(network in NETWORKS)) throw new Error(`unknown network ${network}`);
  if (book?.chainId !== 40204) throw new Error(`book chainId is ${book?.chainId}, expected 40204`);
  if (typeof hardeningRs !== "string") throw new Error("hardening.rs is required (the network's genesis hash)");
  const genesisHash = parseReleaseGenesis(hardeningRs, network);
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

  let genesisAllocations;
  if (NETWORKS[network].allocations === "allocJson") {
    genesisAllocations = parseR1006Allocations(allocJson, book, roleLabels ?? {});
  } else {
    const unlabeled = [];
    genesisAllocations = parseGenesisAllocations(genesisRs).map((g) => {
      const label = genesisLabels[g.constName];
      if (!label) unlabeled.push(g.constName);
      return { address: g.address, label: label ?? "", genesisSalt: g.genesisSalt };
    });
    if (unlabeled.length) throw new Error(`no label for genesis account(s): ${unlabeled.join(", ")}`);
  }
  if (!HASH_RE.test(genesisHash)) throw new Error(`genesis hash is malformed: ${genesisHash}`);
  return { network, genesisHash, precompiles, genesisAllocations };
}

/** Stable JSON for the committed file (with a do-not-edit header), newline-terminated. */
export function serializeChainConstants(constants) {
  return (
    JSON.stringify(
      {
        $comment:
          `GENERATED by \`pnpm sync-addresses\` from citrate-chain (${NETWORKS[constants.network].book}, ` +
          "core/execution/src/precompiles/mod.rs, core/consensus/src/hardening.rs, " +
          (NETWORKS[constants.network].allocations === "allocJson"
            ? "core/economics/assets/r1006/alloc.json"
            : "core/economics/src/genesis.rs") +
          "). Do not edit by hand.",
        chainId: 40204,
        network: constants.network,
        genesisHash: constants.genesisHash,
        precompiles: constants.precompiles,
        genesisAllocations: constants.genesisAllocations,
      },
      null,
      2,
    ) + "\n"
  );
}

