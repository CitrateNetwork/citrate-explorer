/**
 * AgentSBT (HUP US-7.1 AC2): the pure, client-safe half of the explorer's agent
 * identity view. The contract is citrate-chain `contracts/src/cit_agent/AgentSBT.sol`:
 * a soulbound ERC-721 where each token is one agent, parented by an
 * OrganizationSBT. Reads live in `src/lib/harness/agentSbt.ts`; this file holds
 * the address-book lookup, the ABI fragments the reads use, and the formatting
 * helpers the screens and the routes share.
 *
 * Data source (Rule 11): the AgentSBT pinned in the vendored canonical address
 * book (`src/generated/addresses.json`, `contracts.AgentSBT`), read over live RPC.
 */
import { keccak256, parseAbi, parseAbiItem, stringToBytes, type Address, type Hex } from "viem";
import canonicalAddresses from "@/generated/addresses.json";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const WORD_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * The AgentSBT address this explorer reads: `NEXT_PUBLIC_AGENT_SBT` when set to a
 * well-formed address (preview, staging or a local anvil), else the canonical
 * book's `contracts.AgentSBT`. A set but malformed override returns null (it does not
 * fall back to the book), and so does a book with no AgentSBT, so a
 * build whose book has no AgentSBT renders "not in the address book" instead of
 * reading some other contract.
 */
export function agentSbtAddress(
  override: string | undefined = process.env.NEXT_PUBLIC_AGENT_SBT,
  book: Readonly<Record<string, string>> = canonicalAddresses.contracts as Record<string, string>,
): Address | null {
  if (override !== undefined && override !== "") {
    return ADDRESS_RE.test(override) ? (override.toLowerCase() as Address) : null;
  }
  const fromBook = book.AgentSBT;
  return typeof fromBook === "string" && ADDRESS_RE.test(fromBook) ? (fromBook.toLowerCase() as Address) : null;
}

/** True when `addr` is the AgentSBT this explorer reads (case-insensitive). */
export function isAgentSbt(addr: string | null | undefined, sbt: Address | null = agentSbtAddress()): boolean {
  return Boolean(addr && sbt && addr.toLowerCase() === sbt.toLowerCase());
}

/** The AgentSBT read surface (citrate-chain AgentSBT.sol + OpenZeppelin ERC-721). */
export const AGENT_SBT_ABI = parseAbi([
  "function nextTokenId() view returns (uint256)",
  "function getAgent(uint256 tokenId) view returns ((uint256 parent_org_id, bytes32 did, bytes32 pubkey_fingerprint, bool quarantined))",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function orgContract() view returns (address)",
]);

/** The ERC-721 Transfer event (mint is `from` = the zero address). */
export const AGENT_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

/** The parent OrganizationSBT read surface (citrate-chain OrganizationSBT.sol). */
export const ORG_SBT_ABI = parseAbi([
  "function getOrg(uint256 tokenId) view returns ((bytes32 did, address signing_authority, bytes32[] active_overlays, bool active))",
  "function nextTokenId() view returns (uint256)",
]);

/** keccak256("Transfer(address,address,uint256)"), the ERC-721 Transfer topic. */
export const TRANSFER_TOPIC: Hex = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/** Largest token id the explorer accepts. Ids are minted sequentially from 0, so
 *  anything beyond 2^64 cannot exist and is refused before any read. */
export const MAX_AGENT_TOKEN_ID = 2n ** 64n - 1n;

/**
 * Parse a token id from a route or tool argument: a plain decimal string of at
 * most 20 digits with no sign, no spaces and no leading zeros (except "0").
 * Returns null for anything else, so a bad id is a 400, never an RPC call.
 */
export function parseAgentTokenId(raw: unknown): bigint | null {
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw < 0) return null;
    return BigInt(raw);
  }
  if (typeof raw !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(raw)) return null;
  const id = BigInt(raw);
  return id <= MAX_AGENT_TOKEN_ID ? id : null;
}

/** The 32-byte topic word for a uint256 token id. */
export function tokenIdTopic(tokenId: bigint): Hex {
  return `0x${tokenId.toString(16).padStart(64, "0")}` as Hex;
}

/**
 * The DID string citrate-core's in-app mint uses for a member's agent:
 * `did:citrate:agent:<member address, lowercase>`. Its keccak-256 is the bytes32
 * the contract stores. The DID format is pending owner sign-off (g4-identity);
 * the explorer only names a DID string when the stored hash matches this one,
 * and shows the raw hash otherwise.
 */
export function agentDidFor(owner: string): string | null {
  if (!ADDRESS_RE.test(owner)) return null;
  return `did:citrate:agent:${owner.toLowerCase()}`;
}

export interface DidView {
  /** The stored bytes32, 0x hex lowercase. */
  hash: string;
  /** The DID string, only when its keccak-256 equals the stored hash. */
  did: string | null;
  /** True when the stored hash is all zeros (no DID recorded). */
  empty: boolean;
}

/** Describe a stored DID hash, naming the DID string when the owner's DID matches it. */
export function describeDid(stored: string, owner: string | null): DidView {
  const hash = WORD_RE.test(stored) ? stored.toLowerCase() : stored;
  const empty = /^0x0{64}$/i.test(stored);
  const candidate = owner ? agentDidFor(owner) : null;
  const did = candidate && !empty && keccak256(stringToBytes(candidate)) === hash ? candidate : null;
  return { hash, did, empty };
}
