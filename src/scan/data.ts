// @ts-nocheck
/* eslint-disable */
/* CitrateScan — sample data (illustrative testnet-shaped). All fictional.
   Internally consistent so entities cross-link: txns → addresses → blocks → token. */
// ---------- chain ----------
const CHAIN = {
  chainId: 40204,
  chainHex: "0x9D0C",
  network: "Citrate testnet",
  blueScore: 281728,
  height: 281733,
  finalityDepth: 100,
  k: 18,
  maxParents: 10,
  gasless: true,
  gasPriceGwei: 1,
};

// ---------- known labels (the brief prefers labels over hashes) ----------
const L = {
  alice:      { addr: "0xf78c4b2091ad55e0a7c0e3b8f4a1d9c62b0d2915", label: "alice.ctr",            kind: "eoa" },
  foundation: { addr: "0x0f784e9150a3b21c7d44ff0c9e6b1a8d3c0e4915", label: "Citrate Foundation · Relayer", kind: "relayer" },
  router:     { addr: "0x7a3d9f0e21b4c5687a0d1f2e3b4c5d6e7f8b9201", label: "CitrateSwap Router",    kind: "contract" },
  cweth:      { addr: "0x4b22e6f1907c3a5d8e0b2f4a6c8d1e3f5a7b0c7e", label: "cWETH",                 kind: "token" },
  salt:       { addr: "0x0000000000000000000000000000000000000000", label: "SALT",                 kind: "native" },
  modelreg:   { addr: "0x077fbc31a4000000000000000000000000000031", label: "ModelRegistry",        kind: "contract" },
  chatreg:    { addr: "0xc4a71234000000000000000000000000000005e9", label: "ChatRegistry",          kind: "contract" },
  forwarder:  { addr: "0x0f784e915000000000000000000000000004b915", label: "CitrateForwarder",      kind: "contract" },
  bob:        { addr: "0x3a0c6b1e92f4d5a7c80b1e2f3a4b5c6d7e8f0c44", label: "bob.ctr",               kind: "eoa" },
  treasury:   { addr: "0x9e1f2a3b4c5d6e7f8091a2b3c4d5e6f70812aa10", label: "Treasury Multisig",     kind: "contract" },
  market:     { addr: "0x5c8d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d", label: "Citrate Marketplace",   kind: "contract" },
};
// build reverse lookup
const LABELS = {};
Object.values(L).forEach((e) => { LABELS[e.addr.toLowerCase()] = e; });

function short(a) {
  if (!a) return "";
  if (a.length <= 14) return a;
  return a.slice(0, 6) + "…" + a.slice(-4);
}
function labelOf(a) { return LABELS[(a || "").toLowerCase()] || null; }

// ---------- blocks (DAG-shaped) ----------
// selectedParent + mergeParents, blue/red, blueScore, height. Ordered by blueScore.
const TS0 = Date.parse("2026-06-02T14:42:00Z");
function mkBlock(i, o) {
  const blueScore = CHAIN.blueScore - i;
  return {
    hash: o.hash,
    height: CHAIN.height - i,
    blueScore,
    blue: o.blue !== false,
    txCount: o.txCount,
    selectedParent: o.selectedParent || null,
    mergeParents: o.mergeParents || [],
    mergeSet: (o.mergeParents || []).length + 1,
    validator: o.validator || "ctr-val-" + ((blueScore % 100) + 1),
    timestamp: TS0 - i * 1100,
    size: o.size || (12 + (blueScore % 9)),
    tips: o.tips || false,
  };
}
const BLOCKS = [
  mkBlock(0, { hash: "0x9c0fa71b3e", txCount: 7,  selectedParent: "0x7e21bd44a0", mergeParents: ["0x91bda8f0c2"], tips: true }),
  mkBlock(1, { hash: "0x7e21bd44a0", txCount: 4,  selectedParent: "0x3c719ab02f", mergeParents: [] }),
  mkBlock(1, { hash: "0x91bda8f0c2", txCount: 2,  selectedParent: "0x3c719ab02f", mergeParents: [], blue: false, tips: true }),
  mkBlock(2, { hash: "0x3c719ab02f", txCount: 9,  selectedParent: "0xa4c801fd55", mergeParents: ["0x5e2bb01c77"] }),
  mkBlock(3, { hash: "0xa4c801fd55", txCount: 5,  selectedParent: "0xbe2077c4e1", mergeParents: [] }),
  mkBlock(3, { hash: "0x5e2bb01c77", txCount: 1,  selectedParent: "0xbe2077c4e1", mergeParents: [], blue: false }),
  mkBlock(4, { hash: "0xbe2077c4e1", txCount: 6,  selectedParent: "0x11df5e9a30", mergeParents: [] }),
  mkBlock(5, { hash: "0x11df5e9a30", txCount: 8,  selectedParent: "0x9f4a42e1bd", mergeParents: ["0x77b1c3a9e0"] }),
  mkBlock(6, { hash: "0x9f4a42e1bd", txCount: 3,  selectedParent: "0x2b9c44e1aa", mergeParents: [] }),
  mkBlock(6, { hash: "0x77b1c3a9e0", txCount: 2,  selectedParent: "0x2b9c44e1aa", mergeParents: [], blue: false }),
  mkBlock(7, { hash: "0x2b9c44e1aa", txCount: 5,  selectedParent: "0x6dd1aa90fe", mergeParents: [] }),
  mkBlock(8, { hash: "0x6dd1aa90fe", txCount: 4,  selectedParent: null, mergeParents: [] }),
];
const blockByHash = {};
BLOCKS.forEach((b) => { blockByHash[b.hash] = b; });
const TIP_BLOCK = BLOCKS[0]; // selected tip

// ---------- token transfers (reused on token + address pages) ----------
const cweth = L.cweth.addr, salt = L.salt.addr;
function tr(from, to, amount, token, sym, dec) { return { from, to, amount, token, sym, dec }; }

// ---------- transactions ----------
// tx1: marquee swap — success, finalized
const TX = {
  "0x9f4a42e1bd6f0c8a1d3e5b7c9f0a2d4e6b8c0f1a3d5e7c9b0a2f4d6e8c0a2f4e1": {
    hash: "0x9f4a42e1bd6f0c8a1d3e5b7c9f0a2d4e6b8c0f1a3d5e7c9b0a2f4d6e8c0a2f4e1",
    shortHash: "0x9f4a…2f4e1",
    status: "success",
    kind: "swap",
    from: L.alice.addr,
    to: L.router.addr,
    block: "0x9f4a42e1bd",
    blockHeight: 281727,
    blueScore: 281610,
    timestamp: TS0 - 33000,
    nonce: 142,
    gasUsed: 184203,
    gasPaidBy: "foundation",
    valueSalt: "0",
    summary: {
      short: "Swapped 1,250 SALT for 0.42 cWETH.",
      full: "alice.ctr swapped 1,250 SALT for 0.42 cWETH through the CitrateSwap Router. Three internal transfers moved the tokens between the pool and the router. Gas was paid by the Citrate Foundation — not by alice. Finalized · blue · blue_score 281,610.",
    },
    decoded: {
      fn: "swapExactTokensForTokens",
      args: [
        { name: "amountIn", type: "uint256", value: "1,250 SALT" },
        { name: "amountOutMin", type: "uint256", value: "0.41 cWETH" },
        { name: "path", type: "address[]", value: "SALT → cWETH" },
        { name: "to", type: "address", value: L.alice.addr },
        { name: "deadline", type: "uint256", value: "2026-06-02 14:45:00" },
      ],
    },
    transfers: [
      tr(L.alice.addr, L.router.addr, "1,250", salt, "SALT", 18),
      tr(L.router.addr, L.cweth.addr, "1,250", salt, "SALT", 18),
      tr(L.cweth.addr, L.alice.addr, "0.42", cweth, "cWETH", 18),
    ],
    internal: [
      { type: "call", from: L.router.addr, to: L.cweth.addr, value: "1,250 SALT", fn: "swap" },
      { type: "call", from: L.cweth.addr, to: L.alice.addr, value: "0.42 cWETH", fn: "transfer" },
      { type: "staticcall", from: L.router.addr, to: L.cweth.addr, value: "0 SALT", fn: "getReserves" },
    ],
    logs: [
      { addr: L.cweth.addr, name: "Transfer", args: [["from", short(L.alice.addr)], ["to", short(L.router.addr)], ["value", "1,250 SALT"]] },
      { addr: L.router.addr, name: "Swap", args: [["sender", short(L.alice.addr)], ["amountIn", "1,250 SALT"], ["amountOut", "0.42 cWETH"], ["to", short(L.alice.addr)]] },
      { addr: L.cweth.addr, name: "Transfer", args: [["from", short(L.cweth.addr)], ["to", short(L.alice.addr)], ["value", "0.42 cWETH"]] },
    ],
    stateDiff: [
      { entity: L.alice.addr, label: "alice.ctr", key: "SALT balance", before: "4,210 SALT", after: "2,960 SALT", delta: "−1,250" },
      { entity: L.alice.addr, label: "alice.ctr", key: "cWETH balance", before: "1.13 cWETH", after: "1.55 cWETH", delta: "+0.42" },
      { entity: L.cweth.addr, label: "cWETH pool", key: "SALT reserve", before: "1.20M SALT", after: "1.20M SALT", delta: "+1,250" },
    ],
  },
  // tx2: failed swap — custom error
  "0x3a1c0c44e2f6b8d0a1c3e5f7b9d0a2c4e6f8b0d2a4c6e8f0b2d4a6c8e0f2b4d6": {
    hash: "0x3a1c0c44e2f6b8d0a1c3e5f7b9d0a2c4e6f8b0d2a4c6e8f0b2d4a6c8e0f2b4d6",
    shortHash: "0x3a1c…b4d6",
    status: "failed",
    kind: "swap",
    from: L.bob.addr,
    to: L.router.addr,
    block: "0x11df5e9a30",
    blockHeight: 281725,
    blueScore: 281699,
    timestamp: TS0 - 41000,
    nonce: 7,
    gasUsed: 51820,
    gasPaidBy: "foundation",
    valueSalt: "0",
    error: {
      selector: "0x8c379a13",
      signature: "V2TooLittleReceived()",
      plain: "The swap reverted: the output was less than the minimum you asked for (slippage). The price moved between the quote and execution.",
      suggestion: "Try a higher slippage tolerance or a smaller trade size, then resubmit.",
    },
    summary: {
      short: "Swap reverted — output fell below your minimum (slippage).",
      full: "bob.ctr tried to swap 800 SALT for cWETH through the CitrateSwap Router, but the transaction reverted. The router returned less cWETH than the minimum bob set, so it failed safely and no tokens moved. The price drifted between quote and execution. No gas was charged to bob — the Foundation covered the attempt.",
    },
    decoded: {
      fn: "swapExactTokensForTokens",
      args: [
        { name: "amountIn", type: "uint256", value: "800 SALT" },
        { name: "amountOutMin", type: "uint256", value: "0.28 cWETH" },
        { name: "path", type: "address[]", value: "SALT → cWETH" },
      ],
    },
    transfers: [],
    internal: [],
    logs: [],
    stateDiff: [],
  },
  // tx3: pending / stuck
  "0xbe2077c4e1a3c5d7f9b1d3a5c7e9f0b2d4a6c8e0f2b4d6a8c0e2f4b6d8a0c2e4": {
    hash: "0xbe2077c4e1a3c5d7f9b1d3a5c7e9f0b2d4a6c8e0f2b4d6a8c0e2f4b6d8a0c2e4",
    shortHash: "0xbe20…c2e4",
    status: "pending",
    kind: "transfer",
    from: L.alice.addr,
    to: L.bob.addr,
    block: null,
    blockHeight: null,
    blueScore: null,
    timestamp: TS0 - 6000,
    nonce: 143,
    gasPaidBy: "foundation",
    valueSalt: "0",
    pending: { seenBy: 14, mempoolAge: "9s", reason: "waiting to be merged into the blue set" },
    summary: {
      short: "Sending 40 cWETH to bob.ctr — waiting to be merged into the blue set.",
      full: "alice.ctr is sending 40 cWETH to bob.ctr. The transaction has been signed and broadcast; it's now in the mempool, seen by 14 nodes, waiting to be merged into the blue set and then to reach finality depth. Nothing is stuck — on a BlockDAG this is the normal short wait before a block picks it up.",
    },
    decoded: { fn: "transfer", args: [{ name: "to", type: "address", value: L.bob.addr }, { name: "amount", type: "uint256", value: "40 cWETH" }] },
    transfers: [tr(L.alice.addr, L.bob.addr, "40", cweth, "cWETH", 18)],
    internal: [], logs: [], stateDiff: [],
  },
  // tx4: token transfer that reads "0 SALT" — fixes the Etherscan lie
  "0x11df5e9a30c2e4f6b8d0a2c4e6f8b0d2a4c6e8f0b2d4a6c8e0f2b4d6a8c0e2f4": {
    hash: "0x11df5e9a30c2e4f6b8d0a2c4e6f8b0d2a4c6e8f0b2d4a6c8e0f2b4d6a8c0e2f4",
    shortHash: "0x11df…e2f4",
    status: "success",
    kind: "transfer",
    from: L.bob.addr,
    to: L.cweth.addr,
    block: "0x11df5e9a30",
    blockHeight: 281725,
    blueScore: 281699,
    timestamp: TS0 - 52000,
    nonce: 31,
    gasUsed: 38104,
    gasPaidBy: "foundation",
    valueSalt: "0",
    summary: {
      short: "Transferred 12 cWETH to alice.ctr (not a 0-value transaction).",
      full: "bob.ctr transferred 12 cWETH to alice.ctr. The native SALT value of this transaction is 0 — but that headline would lie: the real movement is a 12 cWETH token transfer. Gas was paid by the Foundation. Finalized · blue.",
    },
    decoded: { fn: "transfer", args: [{ name: "to", type: "address", value: L.alice.addr }, { name: "amount", type: "uint256", value: "12 cWETH" }] },
    transfers: [tr(L.bob.addr, L.alice.addr, "12", cweth, "cWETH", 18)],
    internal: [],
    logs: [{ addr: L.cweth.addr, name: "Transfer", args: [["from", short(L.bob.addr)], ["to", short(L.alice.addr)], ["value", "12 cWETH"]] }],
    stateDiff: [
      { entity: L.bob.addr, label: "bob.ctr", key: "cWETH balance", before: "60 cWETH", after: "48 cWETH", delta: "−12" },
      { entity: L.alice.addr, label: "alice.ctr", key: "cWETH balance", before: "1.55 cWETH", after: "13.55 cWETH", delta: "+12" },
    ],
  },
};
const txList = Object.values(TX);
// map short → full hash
const txByShort = {};
txList.forEach((t) => { txByShort[t.shortHash] = t.hash; });

// ---------- latest transactions (home + blocks) ----------
const LATEST_TX = [
  { hash: txList[0].hash, shortHash: "0x9f4a…2f4e1", kind: "swap",     action: "Swap 1,250 SALT → 0.42 cWETH", from: L.alice.addr, status: "success", age: "33s" },
  { hash: txList[3].hash, shortHash: "0x11df…e2f4",  kind: "transfer", action: "Transfer 12 cWETH",            from: L.bob.addr,   status: "success", age: "52s" },
  { hash: txList[1].hash, shortHash: "0x3a1c…b4d6",  kind: "swap",     action: "Swap 800 SALT (reverted)",     from: L.bob.addr,   status: "failed",  age: "41s" },
  { hash: txList[2].hash, shortHash: "0xbe20…c2e4",  kind: "transfer", action: "Send 40 cWETH",                from: L.alice.addr, status: "pending", age: "6s" },
  { hash: txList[0].hash, shortHash: "0x7c91…0ab3",  kind: "anchor",   action: "anchorReceipt",                from: L.foundation.addr, status: "success", age: "1m" },
  { hash: txList[3].hash, shortHash: "0x4e08…9d22",  kind: "mint",     action: "Mint model attestation",       from: L.modelreg.addr, status: "success", age: "1m" },
];

// ---------- addresses ----------
const ADDR = {
  [L.alice.addr]: {
    addr: L.alice.addr, label: "alice.ctr", isContract: false,
    balanceSalt: "2,960", balanceUsd: "—",
    firstSeen: "2026-04-11", lastSeen: "2026-06-02", txCount: 318,
    summary: "alice.ctr is an active wallet — 318 transactions, mostly swaps and cWETH transfers through CitrateSwap. It holds 2,960 SALT and 1.55 cWETH. No gas was ever paid by this wallet; every action was sponsored by the Foundation relayer.",
    tokens: [
      { token: salt, sym: "SALT", name: "Citrate", balance: "2,960", value: "—" },
      { token: cweth, sym: "cWETH", name: "Wrapped Ether", balance: "1.55", value: "—" },
    ],
    txns: [
      { hash: txList[0].hash, shortHash: "0x9f4a…2f4e1", dir: "out", kind: "swap", action: "Swap 1,250 SALT → 0.42 cWETH", counter: L.router.addr, status: "success", age: "33s" },
      { hash: txList[2].hash, shortHash: "0xbe20…c2e4", dir: "out", kind: "transfer", action: "Send 40 cWETH", counter: L.bob.addr, status: "pending", age: "6s" },
      { hash: txList[3].hash, shortHash: "0x11df…e2f4", dir: "in", kind: "transfer", action: "Receive 12 cWETH", counter: L.bob.addr, status: "success", age: "52s" },
      { hash: txList[0].hash, shortHash: "0x5be1…77a0", dir: "out", kind: "swap", action: "Swap 500 SALT → 0.17 cWETH", counter: L.router.addr, status: "success", age: "4m" },
      { hash: txList[0].hash, shortHash: "0xaa31…0d4f", dir: "in", kind: "transfer", action: "Receive 1,000 SALT", counter: L.treasury.addr, status: "success", age: "2h" },
    ],
  },
  [L.router.addr]: {
    addr: L.router.addr, label: "CitrateSwap Router", isContract: true, verified: true,
    balanceSalt: "0", contractName: "CitrateRouter",
    firstSeen: "2026-02-02", lastSeen: "2026-06-02", txCount: 49120,
    summary: "CitrateSwap Router is a verified swap router contract — the most-used contract on the testnet with 49,120 interactions. It routes token swaps between SALT and cWETH pools. Source is verified; Read and Write tabs are available.",
    tokens: [], txns: [],
  },
};

// ---------- contract (verified) ----------
const CONTRACT = {
  [L.router.addr]: {
    addr: L.router.addr, name: "CitrateRouter", label: "CitrateSwap Router",
    verified: true, compiler: "v0.8.26+commit.8a97fa7a", optimizer: "200 runs", license: "MIT",
    evmVersion: "shanghai", createdBlock: 198440, createdTx: "0x2c91…a0b4",
    summary: "CitrateRouter is a verified Uniswap-V2-style swap router. It swaps SALT for cWETH (and back) across the pooled reserves, enforcing a caller-set minimum output to protect against slippage. It holds no funds itself — tokens flow through it in a single transaction. Writes are gasless: you sign, the Foundation pays.",
    sources: [
      { name: "CitrateRouter.sol", code: "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.26;\n\nimport \"./interfaces/IERC20.sol\";\nimport \"./libraries/SafeTransfer.sol\";\n\n/// @title CitrateRouter\n/// @notice Slippage-protected swap router for SALT <> cWETH.\ncontract CitrateRouter {\n    address public immutable factory;\n    address public immutable salt;\n\n    error V2TooLittleReceived();\n    error Expired();\n\n    event Swap(address indexed sender, uint amountIn, uint amountOut, address indexed to);\n\n    constructor(address _factory, address _salt) {\n        factory = _factory;\n        salt = _salt;\n    }\n\n    function swapExactTokensForTokens(\n        uint amountIn,\n        uint amountOutMin,\n        address[] calldata path,\n        address to,\n        uint deadline\n    ) external returns (uint amountOut) {\n        if (block.timestamp > deadline) revert Expired();\n        amountOut = _swap(amountIn, path);\n        if (amountOut < amountOutMin) revert V2TooLittleReceived();\n        emit Swap(msg.sender, amountIn, amountOut, to);\n    }\n\n    // ... reserves math omitted for brevity ...\n}\n" },
      { name: "interfaces/IERC20.sol", code: "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.26;\n\ninterface IERC20 {\n    function balanceOf(address) external view returns (uint256);\n    function transfer(address to, uint256 amount) external returns (bool);\n    function transferFrom(address from, address to, uint256 amount) external returns (bool);\n}\n" },
    ],
    reads: [
      { fn: "factory", inputs: [], outputs: "address", result: L.market.addr },
      { fn: "salt", inputs: [], outputs: "address", result: L.salt.addr },
      { fn: "getAmountOut", inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }], outputs: "uint256", result: "0.42 cWETH" },
      { fn: "getReserves", inputs: [], outputs: "(uint112, uint112)", result: "1.20M SALT · 402.6 cWETH" },
    ],
    writes: [
      { fn: "swapExactTokensForTokens", inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }] },
      { fn: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }] },
    ],
    events: [
      { name: "Swap", count: 38201 },
      { name: "Sync", count: 41882 },
    ],
  },
};

// ---------- token (cWETH) ----------
const TOKEN = {
  [L.cweth.addr]: {
    addr: L.cweth.addr, name: "Wrapped Ether (Citrate)", symbol: "cWETH", decimals: 18,
    supply: "402,604.18", holderCount: 1284, transferCount: 96402, verified: true,
    summary: "cWETH is the Citrate-wrapped form of Ether — an ERC-20 that mirrors ETH 1:1, used as the quote asset in CitrateSwap pools. Total supply is 402,604 cWETH across 1,284 holders. It is a verified contract; the top holder is the CitrateSwap pool itself.",
    holders: [
      { rank: 1, addr: L.cweth.addr, label: "CitrateSwap Pool", balance: "402.60", pct: 0.10 },
      { rank: 2, addr: L.treasury.addr, label: "Treasury Multisig", balance: "180,402.11", pct: 44.81 },
      { rank: 3, addr: L.foundation.addr, label: "Foundation Reserve", balance: "98,210.00", pct: 24.39 },
      { rank: 4, addr: L.market.addr, label: "Marketplace Escrow", balance: "42,118.45", pct: 10.46 },
      { rank: 5, addr: L.alice.addr, label: "alice.ctr", balance: "13.55", pct: 0.003 },
      { rank: 6, addr: L.bob.addr, label: "bob.ctr", balance: "48.00", pct: 0.012 },
    ],
    transfers: [
      { hash: txList[3].hash, shortHash: "0x11df…e2f4", from: L.bob.addr, to: L.alice.addr, amount: "12", age: "52s" },
      { hash: txList[0].hash, shortHash: "0x9f4a…2f4e1", from: L.cweth.addr, to: L.alice.addr, amount: "0.42", age: "33s" },
      { hash: txList[2].hash, shortHash: "0xbe20…c2e4", from: L.alice.addr, to: L.bob.addr, amount: "40", age: "6s" },
      { hash: txList[0].hash, shortHash: "0x5be1…77a0", from: L.router.addr, to: L.alice.addr, amount: "0.17", age: "4m" },
    ],
  },
};

// SALT native "token" page entry (top holders on home / dag)
const SALT_HOLDERS = [
  { rank: 1, addr: L.treasury.addr, label: "Treasury Multisig", balance: "41.2M", pct: 41.2 },
  { rank: 2, addr: L.foundation.addr, label: "Foundation Reserve", balance: "22.8M", pct: 22.8 },
  { rank: 3, addr: L.market.addr, label: "Citrate Marketplace", balance: "8.1M", pct: 8.1 },
  { rank: 4, addr: L.router.addr, label: "CitrateSwap Router", balance: "1.2M", pct: 1.2 },
  { rank: 5, addr: L.alice.addr, label: "alice.ctr", balance: "2,960", pct: 0.003 },
];

// ---------- agent scripts ----------
// each: trigger regex, tool trace steps, markdown answer w/ {{entity refs}}, sources
const AGENT = {
  SYSTEM_PROMPT: `You are Ask CitrateScan, the assistant woven into the CitrateScan block explorer for the Citrate Network (chain 40204, a GHOSTDAG BlockDAG).

Rules you run under:
- Use the read-only harness tools for any factual claim. Never guess on-chain facts. Cite the block height you observed.
- Prefer the indexer for ranked/aggregate questions (topHolders, searchTransactions) and RPC for authoritative single reads (getTransaction, getBlock).
- Render every on-chain reference as a clickable entity. End substantive answers with the exact reads you made.
- Lead with plain English. Never headline a token transfer as "0 SALT". Say "Finalized" / "Finalizing — depth n/100", never "confirmations".
- You cannot sign, send, or write to the chain. There is no signer in the harness. If asked to move funds, explain that you are read-only by construction.`,
  scripts: [
    {
      match: /explain|what happened|this transaction|this tx|0x9f4a/i,
      seed: "tx",
      trace: [
        { tool: "getTransaction", args: "0x9f4a…2f4e1", note: "reading receipt + decoded calldata" },
        { tool: "getLogs", args: "0x9f4a…2f4e1", note: "decoding 3 event logs" },
        { tool: "explainTransaction", args: "0x9f4a…2f4e1", note: "composing narrative" },
      ],
      answer: "Here's what this transaction did, in plain English:\n\n**{{alice}} swapped 1,250 SALT for 0.42 cWETH** through the {{router}}. Under the hood, three internal transfers moved the tokens — SALT into the pool, cWETH back out to alice.\n\nThe transaction's native SALT value reads `0`, but that's not the real story — the meaningful movement is the **token swap**, not a zero transfer.\n\nGas was **paid by the {{foundation}}**, not by alice — that's the gasless model: she signed, the Foundation paid. The block is **finalized** (blue, blue_score 281,610).",
      sources: ["getTransaction → block #281,727", "getLogs → 3 Transfer/Swap events", "getBlock → blue_score 281,610, finalized"],
    },
    {
      match: /why.*fail|revert|error|slippage|3a1c/i,
      seed: "fail",
      trace: [
        { tool: "getTransaction", args: "0x3a1c…b4d6", note: "status = reverted" },
        { tool: "diagnoseFailure", args: "0x3a1c…b4d6", note: "re-running eth_call at block, decoding revert" },
      ],
      answer: "This swap **reverted** — nothing moved, and bob wasn't charged.\n\nThe contract threw `V2TooLittleReceived()`. In plain terms: the router would have returned **less cWETH than the minimum {{bob}} set**, so it refused the trade rather than give a worse price. The pool price drifted between the quote and execution.\n\nWhat to do: raise the slippage tolerance a little, or trade a smaller size, and resubmit. The Foundation covered the gas for the failed attempt — failures are free here too.",
      sources: ["getTransaction → status reverted, block #281,725", "diagnoseFailure → V2TooLittleReceived() decoded"],
    },
    {
      match: /top holder|who holds|holders|most salt|richest/i,
      seed: "holders",
      trace: [
        { tool: "topHolders", args: "token: SALT, limit: 5", note: "ranking indexer holder table" },
      ],
      answer: "The top SALT holders right now:\n\n1. {{treasury}} — **41.2M SALT** (41.2%)\n2. {{foundation}} — **22.8M SALT** (22.8%)\n3. {{market}} — **8.1M SALT** (8.1%)\n4. {{router}} — **1.2M SALT** (1.2%)\n\nThe top two are protocol-controlled (treasury + foundation reserve), which is normal for a testnet at this stage. I ranked these from the indexer holder table as of the current tip.",
      sources: ["topHolders(SALT) → indexer, observed at blue_score 281,728"],
    },
    {
      match: /dag|ghostdag|tip|blue|red|finality|order/i,
      seed: "dag",
      trace: [
        { tool: "getChainStatus", args: "—", note: "reading tip + blue_score" },
        { tool: "exploreDag", args: "depth: 8", note: "tips, selected parent, blue/red" },
      ],
      answer: "Right now the DAG has **2 live tips** at the frontier — {{tipblock}} and a parallel red block. Here's how to read it:\n\n- **Blue blocks** are in the well-connected cluster of the selected-parent chain. **Red blocks** arrived in parallel and sit outside it — still valid, just ordered later (GHOSTDAG, k=18).\n- Each block has **one selected parent** (the bold edge) and up to 10 **merge parents** (thin edges).\n- A block is **finalized** when the tip's blue_score is at least 100 ahead of it — not after a fixed number of \"confirmations.\"\n\nThe current max blue_score is **281,728**. Open the {{dag}} to watch new blocks land at the frontier.",
      sources: ["getChainStatus → blue_score 281,728", "exploreDag → 2 tips, k=18, finalityDepth 100"],
    },
    {
      match: /gas|sponsor|pay|free|fee|gasless/i,
      seed: "gas",
      trace: [{ tool: "getTransaction", args: "0x9f4a…2f4e1", note: "checking gasPaidBy" }],
      answer: "You don't pay gas on Citrate — and you can verify it on-chain.\n\nWhen you authorize a write, you sign an **EIP-712 ForwardRequest** (a typed message, no value, costs nothing). The {{foundation}} relayer wraps it in a real transaction and pays the gas through the `CitrateForwarder` contract. On any tx you'll see **\"Gas paid by Citrate Foundation\"** — the relayer's wallet is the on-chain payer, your signature is the authorization. There's no native paymaster; this is an app-layer EIP-2771 forwarder.",
      sources: ["getTransaction → gasPaidBy: Citrate Foundation"],
    },
  ],
  fallback: {
    trace: [{ tool: "semanticSearch", args: "your query", note: "searching indexed entities" }],
    answer: "I read on-chain and the index to answer that — but I don't have a scripted result for this exact question in the prototype. In the live explorer I'd call `semanticSearch` plus the relevant tools (`getTransaction`, `topHolders`, `exploreDag`, …) and cite the block height I observed. Try one of the suggested prompts, or ask me to explain a specific transaction, address, or block.",
    sources: ["semanticSearch → indexer (prototype: no scripted match)"],
  },
  prompts: [
    "Explain transaction 0x9f4a…2f4e1",
    "Who holds the most SALT?",
    "Why did 0x3a1c…b4d6 fail?",
    "How does GHOSTDAG order blocks?",
  ],
};

// ---------- audit log seed (transparency) ----------
const AUDIT = [
  { op: "getTransaction", backing: "eth_getTransactionByHash", latency: 31, decoded: true, cache: false, age: "2s" },
  { op: "getLogs", backing: "eth_getLogs", latency: 44, decoded: true, cache: false, age: "2s" },
  { op: "topHolders", backing: "indexer (DB)", latency: 18, decoded: true, cache: true, age: "12s" },
  { op: "getChainStatus", backing: "eth_blockNumber", latency: 9, decoded: true, cache: true, age: "4s" },
  { op: "exploreDag", backing: "citrate_getDagStats", latency: 27, decoded: true, cache: false, age: "1m" },
  { op: "getBlock", backing: "eth_getBlockByNumber", latency: 22, decoded: true, cache: true, age: "1m" },
];

// ---------- allowlist (transparency) ----------
const ALLOWLIST = {
  allowed: ["eth_chainId", "eth_blockNumber", "eth_gasPrice", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_call", "eth_estimateGas", "eth_getLogs", "eth_getTransactionCount", "citrate_getDagStats", "citrate_semanticSearch", "citrate_getTextEmbedding"],
  forbidden: ["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "eth_signTypedData_v4", "personal_sign", "eth_accounts", "wallet_addEthereumChain", "wallet_*"],
};

// ---------- API keys (settings) ----------
const API_KEYS = [
  { id: "k1", masked: "ctr_sk_live_••••••••••••a31f", created: "2026-05-18", quotaUsed: 4120, quotaLimit: 10000 },
  { id: "k2", masked: "ctr_sk_live_••••••••••••9b02", created: "2026-04-02", quotaUsed: 812, quotaLimit: 10000 },
];

export const SD = {
  CHAIN, L, LABELS, short, labelOf,
  BLOCKS, blockByHash, TIP_BLOCK,
  TX, txList, txByShort, LATEST_TX,
  ADDR, CONTRACT, TOKEN, SALT_HOLDERS,
  AGENT, AUDIT, ALLOWLIST, API_KEYS,
  fmtAge: (ts) => {
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  },
};
