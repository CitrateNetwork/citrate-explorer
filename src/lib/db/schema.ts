/**
 * Drizzle schema for CitrateScan (Neon Postgres).
 *
 * Two halves:
 *  - the CHAIN INDEX, written by the indexer worker (src/lib/indexer) from live
 *    RPC. DAG-native: blocks carry blue_score + finalized; parent links live in
 *    `dagEdges` (selected vs merge). uint256 values are stored as text to avoid
 *    precision loss.
 *  - USER tables. Per the hybrid model (CONFIG.md): `settings` holds E2EE
 *    ciphertext the server can't read; `apiKeys` holds only a salted hash;
 *    `providerKeys` / `messages` / `threadMemory` hold server-decryptable
 *    AES-256-GCM envelopes (ciphertext/iv/authTag columns).
 */
import {
  pgTable,
  pgEnum,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  serial,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

/** DAG parent-edge kind: the single selected parent (chain link) vs merge parents. */
export const dagEdgeKind = pgEnum("dag_edge_kind", [
  "selected_parent",
  "merge_parent",
]);

// --- Chain index ------------------------------------------------------------

export const blocks = pgTable(
  "blocks",
  {
    hash: text("hash").primaryKey(),
    height: bigint("height", { mode: "number" }).notNull(),
    blueScore: bigint("blue_score", { mode: "number" }).notNull(),
    blueWork: text("blue_work").notNull().default("0"),
    isBlue: boolean("is_blue").notNull().default(true),
    finalized: boolean("finalized").notNull().default(false),
    // Reorg handling (WP-1.3): a block displaced below finality is marked
    // superseded, NEVER deleted. Finalized blocks (depth >= 100) are immutable.
    superseded: boolean("superseded").notNull().default(false),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    selectedParent: text("selected_parent"),
    proposer: text("proposer"),
    gasUsed: bigint("gas_used", { mode: "number" }).notNull().default(0),
    gasLimit: bigint("gas_limit", { mode: "number" }).notNull().default(0),
    baseFeePerGas: text("base_fee_per_gas"),
    txCount: integer("tx_count").notNull().default(0),
    stateRoot: text("state_root"),
    txRoot: text("tx_root"),
    receiptRoot: text("receipt_root"),
  },
  (t) => [
    index("blocks_height_idx").on(t.height),
    index("blocks_blue_score_idx").on(t.blueScore),
    index("blocks_timestamp_idx").on(t.timestamp),
  ],
);

/**
 * Parent links of the DAG. One row per (child, parent). `kind` distinguishes the
 * single `selected_parent` (chain link) from the 0–10 `merge_parent` edges, so a
 * downstream view can draw the selected-parent spine distinctly from merge edges.
 */
export const dagEdges = pgTable(
  "dag_edges",
  {
    childHash: text("child_hash").notNull(),
    parentHash: text("parent_hash").notNull(),
    kind: dagEdgeKind("kind").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.childHash, t.parentHash] }),
    index("dag_edges_child_idx").on(t.childHash),
    index("dag_edges_parent_idx").on(t.parentHash),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    hash: text("hash").primaryKey(),
    blockHash: text("block_hash"),
    blockHeight: bigint("block_height", { mode: "number" }),
    txIndex: integer("tx_index"),
    from: text("from_addr").notNull(),
    to: text("to_addr"),
    value: text("value").notNull().default("0"),
    nonce: bigint("nonce", { mode: "number" }),
    gasLimit: bigint("gas_limit", { mode: "number" }),
    gasPrice: text("gas_price"),
    status: integer("status"), // 1 success, 0 failed, null pending
    methodId: text("method_id"), // first 4 bytes of input
    ethTxType: integer("eth_tx_type"),
    createdContract: text("created_contract"),
    timestamp: bigint("timestamp", { mode: "number" }),
  },
  (t) => [
    index("tx_from_idx").on(t.from),
    index("tx_to_idx").on(t.to),
    index("tx_block_idx").on(t.blockHeight),
    index("tx_timestamp_idx").on(t.timestamp),
  ],
);

export const receipts = pgTable("receipts", {
  txHash: text("tx_hash").primaryKey(),
  status: integer("status"),
  gasUsed: bigint("gas_used", { mode: "number" }),
  cumulativeGasUsed: bigint("cumulative_gas_used", { mode: "number" }),
  contractAddress: text("contract_address"),
  logsCount: integer("logs_count").notNull().default(0),
});

export const logs = pgTable(
  "logs",
  {
    id: serial("id").primaryKey(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    address: text("address").notNull(),
    topic0: text("topic0"),
    topic1: text("topic1"),
    topic2: text("topic2"),
    topic3: text("topic3"),
    data: text("data"),
    blockHeight: bigint("block_height", { mode: "number" }),
  },
  (t) => [
    index("logs_address_idx").on(t.address),
    index("logs_topic0_idx").on(t.topic0),
    index("logs_tx_idx").on(t.txHash),
  ],
);

export const accounts = pgTable("accounts", {
  address: text("address").primaryKey(),
  balance: text("balance").notNull().default("0"),
  nonce: bigint("nonce", { mode: "number" }).notNull().default(0),
  isContract: boolean("is_contract").notNull().default(false),
  txCount: integer("tx_count").notNull().default(0),
  firstSeen: bigint("first_seen", { mode: "number" }),
  lastSeen: bigint("last_seen", { mode: "number" }),
});

export const contracts = pgTable("contracts", {
  address: text("address").primaryKey(),
  creator: text("creator"),
  creationTx: text("creation_tx"),
  bytecodeHash: text("bytecode_hash"),
  verified: boolean("verified").notNull().default(false),
  name: text("name"),
  compilerVersion: text("compiler_version"),
  proxyImpl: text("proxy_impl"),
});

export const tokens = pgTable("tokens", {
  address: text("address").primaryKey(),
  type: text("type").notNull(), // erc20 | erc721 | erc1155
  name: text("name"),
  symbol: text("symbol"),
  decimals: integer("decimals"),
  totalSupply: text("total_supply"),
});

export const tokenTransfers = pgTable(
  "token_transfers",
  {
    id: serial("id").primaryKey(),
    txHash: text("tx_hash").notNull(),
    // RA-3: provenance for reorg-safe cleanup + time/standard queries.
    blockHash: text("block_hash"),
    blockHeight: bigint("block_height", { mode: "number" }),
    timestamp: bigint("timestamp", { mode: "number" }),
    token: text("token").notNull(),
    standard: text("standard"), // erc20 | erc721 | erc1155
    from: text("from_addr").notNull(),
    to: text("to_addr").notNull(),
    value: text("value"),
    tokenId: text("token_id"),
    logIndex: integer("log_index"),
  },
  (t) => [
    // One row per (tx, logIndex, tokenId) — ERC-1155 batch shares a logIndex across ids.
    uniqueIndex("tt_tx_log_id_uq").on(t.txHash, t.logIndex, t.tokenId),
    index("tt_token_idx").on(t.token),
    index("tt_from_idx").on(t.from),
    index("tt_to_idx").on(t.to),
    index("tt_block_idx").on(t.blockHeight),
    index("tt_timestamp_idx").on(t.timestamp),
  ],
);

export const contractVerifications = pgTable(
  "contract_verifications",
  {
    guid: text("guid").primaryKey(),
    address: text("address").notNull(),
    status: text("status").notNull().default("pending"), // pending | pass | fail
    matchType: text("match_type"), // full | partial | null
    compilerVersion: text("compiler_version"),
    sourceHash: text("source_hash"),
    /** The verified contract name (file:Name) once matched. */
    contractName: text("contract_name"),
    /** Verified source (public) + ABI JSON, rendered on the contract page. */
    source: text("source"),
    abi: text("abi"),
    message: text("message"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (t) => [index("contract_verifications_address_idx").on(t.address)],
);

/** Singleton indexer cursor — lets the worker resume with zero gaps/duplicates. */
export const indexerState = pgTable("indexer_state", {
  id: integer("id").primaryKey().default(1),
  lastHeight: bigint("last_height", { mode: "number" }).notNull().default(0),
  lastBlueScore: bigint("last_blue_score", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// --- User tables ------------------------------------------------------------

/**
 * E2EE: server stores opaque ciphertext it cannot read (key is client-held).
 *
 * Ownership is keyed by the stable OIDC `subject` (SR-0) so email/social/passkey
 * users with no wallet are first-class. `user_address` is retained transitionally
 * (dual-written = subject) and dropped at the SR-0 cutover migration.
 */
export const settings = pgTable(
  "settings",
  {
    userAddress: text("user_address").primaryKey(),
    subject: text("subject"),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("settings_subject_idx").on(t.subject)],
);

/** Our issued API keys — only the salted hash is stored. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    userAddress: text("user_address").notNull(),
    subject: text("subject"),
    keyHash: text("key_hash").notNull(),
    /**
     * How key_hash was derived. Rows from earlier releases default to "legacy" and never match or
     * count toward the per-owner cap; the current code writes and reads only API_KEY_SCHEME_CURRENT.
     */
    keyScheme: text("key_scheme").notNull().default("legacy"),
    label: text("label"),
    quotaPerDay: integer("quota_per_day").notNull().default(100_000),
    rateLimitPerSec: integer("rate_limit_per_sec").notNull().default(5),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastUsed: timestamp("last_used", { withTimezone: true }),
  },
  (t) => [index("api_keys_hash_idx").on(t.keyHash), index("api_keys_subject_idx").on(t.subject)],
);

/** Third-party provider keys the agent uses server-side — sealed AES-256-GCM. */
export const providerKeys = pgTable(
  "provider_keys",
  {
    id: serial("id").primaryKey(),
    userAddress: text("user_address").notNull(),
    subject: text("subject"),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
  },
  (t) => [index("provider_keys_subject_idx").on(t.subject)],
);

export const watchlist = pgTable(
  "watchlist",
  {
    id: serial("id").primaryKey(),
    userAddress: text("user_address").notNull(),
    subject: text("subject"),
    // SR-3: E2EE at rest. `target`/`label` hold ciphertext (+ iv); `blindIndex`
    // is a keyed HMAC of the watched address so the alerts worker can match
    // on-chain activity without reading the list. Legacy plaintext rows are
    // re-encrypted on next authenticated load (migrate-on-read).
    target: text("target").notNull(),
    label: text("label"),
    iv: text("iv"),
    blindIndex: text("blind_index"),
    encrypted: boolean("encrypted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("watchlist_subject_idx").on(t.subject),
    index("watchlist_blind_index_idx").on(t.blindIndex),
  ],
);

/** Transparency: every harness tool call the agent makes, for the audit panel. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    userAddress: text("user_address"),
    subject: text("subject"),
    tool: text("tool").notNull(),
    args: text("args"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("audit_user_idx").on(t.userAddress), index("audit_subject_idx").on(t.subject)],
);

export const threads = pgTable(
  "threads",
  {
    id: text("id").primaryKey(),
    userAddress: text("user_address").notNull(),
    subject: text("subject"),
    title: text("title").notNull().default("New chat"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("threads_user_updated_idx").on(t.userAddress, t.updatedAt),
    index("threads_subject_updated_idx").on(t.subject, t.updatedAt),
  ],
);

/** Encrypted message bodies (server-decryptable envelope). */
export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    role: text("role").notNull(), // user | assistant | system
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("messages_thread_created_idx").on(t.threadId, t.createdAt)],
);

export const threadMemory = pgTable("thread_memory", {
  threadId: text("thread_id").primaryKey(),
  summaryCiphertext: text("summary_ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
