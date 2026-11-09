/**
 * Test-only: an in-memory chain reader for the contract module and a recording
 * fake wallet. Never imported by production code (same pattern as
 * src/lib/db/tests/pglite.ts). Contracts are described by real ABIs and answer
 * eth_call by ABI-encoding a handler's return value, so encode/decode paths
 * run for real.
 */
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeFunctionResult,
  parseAbi,
  toFunctionSelector,
  type Abi,
} from "viem";
import type { Address, Hex } from "@/lib/contracts/types";
import type { ContractModuleDeps } from "../contractModule";
import type { ChainReader } from "@/lib/contract/types";
import { shapeVerifiedSource, type VerifiedSource } from "@/lib/verify/verifiedSource";
import { keccak256, toBytes } from "viem";

// Computed here (not imported from contractModule) so a test may mock that module
// and still build this fake inside the mock factory without an import cycle.
const IMPL_SLOT = `0x${(BigInt(keccak256(toBytes("eip1967.proxy.implementation"))) - 1n).toString(16).padStart(64, "0")}`;

export const ALICE = "0x00000000000000000000000000000000000a11ce" as Address;
export const MALLORY = "0x000000000000000000000000000000000000bad1" as Address;
export const TOKEN = "0x1000000000000000000000000000000000000001" as Address;
export const PROXY = "0x2000000000000000000000000000000000000002" as Address;
export const IMPL = "0x3000000000000000000000000000000000000003" as Address;
export const UNVERIFIED = "0x4000000000000000000000000000000000000004" as Address;
export const EOA = "0x5000000000000000000000000000000000000005" as Address;
export const CLONE = "0x6000000000000000000000000000000000000006" as Address;

export const TOKEN_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit() payable",
  "function setLabel(string label)",
  "function transferOwnership(address newOwner)",
  "function isTrustedForwarder(address forwarder) view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Note(string text)",
  "error InsufficientBalance(uint256 have, uint256 want)",
]);

export const IMPL_ABI = parseAbi([
  "function stake(uint256 amount)",
  "function staked(address) view returns (uint256)",
  "function upgradeTo(address newImplementation)",
]);

type Handler = (args: readonly unknown[], ctx: { from?: Address; value: bigint }) => unknown;

interface FakeContract {
  code: Hex;
  abi?: Abi;
  handlers?: Record<string, Handler>;
  storage?: Record<string, Hex>;
}

export class CallReverted extends Error {
  constructor(public data: Hex) {
    super("execution reverted");
  }
}

export interface FakeChainOptions {
  tokenName?: string;
  natspecSource?: string;
  /** The EIP-2771 forwarder the fake TOKEN trusts (isTrustedForwarder), and the module is configured with. */
  forwarder?: Address | null;
}

/** The forwarder the fake deployment is configured with by default. */
export const FORWARDER = "0x7000000000000000000000000000000000000007" as Address;

export function fakeChain(opts: FakeChainOptions = {}) {
  const balances = new Map<string, bigint>([[ALICE.toLowerCase(), 1000n]]);
  const contracts = new Map<string, FakeContract>();
  const calls: Array<{ method: string; args: unknown }> = [];
  const slot = (a: Address) => `0x${a.slice(2).padStart(64, "0")}` as Hex;

  contracts.set(TOKEN.toLowerCase(), {
    code: "0x6080604052",
    abi: TOKEN_ABI,
    handlers: {
      name: () => opts.tokenName ?? "Test Token",
      symbol: () => "TST",
      decimals: () => 18,
      totalSupply: () => 1_000_000n,
      balanceOf: ([a]) => balances.get(String(a).toLowerCase()) ?? 0n,
      transfer: ([, amount], { from }) => {
        const have = balances.get((from ?? "").toLowerCase()) ?? 0n;
        if (have < (amount as bigint)) throw new CallReverted(encodeErrorResult({ abi: TOKEN_ABI, errorName: "InsufficientBalance", args: [have, amount as bigint] }));
        return true;
      },
      approve: () => true,
      deposit: () => undefined,
      setLabel: () => undefined,
      transferOwnership: () => undefined,
      isTrustedForwarder: ([f]) => String(f).toLowerCase() === (opts.forwarder === undefined ? FORWARDER : (opts.forwarder ?? "")).toLowerCase(),
      supportsInterface: () => {
        throw new CallReverted("0x");
      },
    },
  });
  contracts.set(PROXY.toLowerCase(), {
    code: "0x60806040526000",
    abi: IMPL_ABI,
    handlers: { stake: () => undefined, staked: () => 7n, upgradeTo: () => undefined },
    storage: { [IMPL_SLOT]: slot(IMPL) },
  });
  contracts.set(IMPL.toLowerCase(), { code: "0x6080604052600a", abi: IMPL_ABI, handlers: {} });
  contracts.set(UNVERIFIED.toLowerCase(), {
    code: "0x60806040",
    abi: parseAbi(["function poke(uint256 n)", "function setApprovalForAll(address operator, bool approved)", "function revertMe(string why)"]),
    handlers: {
      poke: () => undefined,
      setApprovalForAll: () => undefined,
      revertMe: ([why]) => {
        throw new CallReverted(encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: [String(why)] }));
      },
    },
  });
  contracts.set(CLONE.toLowerCase(), { code: `0x363d3d373d3d3d363d73${IMPL.slice(2)}5af43d82803e903d91602b57fd5bf3` as Hex });

  // The kit's ChainReader (src/lib/contract/types.ts): read-only, no account, no send.
  const reader: ChainReader = {
    chainId: 40204,
    async getCode(address) {
      calls.push({ method: "eth_getCode", args: address });
      return contracts.get(address.toLowerCase())?.code ?? "0x";
    },
    async getStorageAt(address, s) {
      calls.push({ method: "eth_getStorageAt", args: [address, s] });
      return contracts.get(address.toLowerCase())?.storage?.[s.toLowerCase()] ?? (`0x${"0".repeat(64)}` as Hex);
    },
    async call({ from, to, data, value }) {
      calls.push({ method: "eth_call", args: { account: from, to, data, value } });
      const c = contracts.get(to.toLowerCase());
      if (!c || !c.abi) throw new CallReverted("0x");
      const sel = data.slice(0, 10);
      if (sel === toFunctionSelector("supportsInterface(bytes4)")) throw new CallReverted("0x");
      let decoded;
      try {
        decoded = decodeFunctionData({ abi: c.abi, data });
      } catch {
        throw new CallReverted("0x");
      }
      const h = c.handlers?.[decoded.functionName];
      if (!h) throw new CallReverted("0x");
      const out = h(decoded.args ?? [], { from, value: value ?? 0n });
      const frag = (c.abi as Abi).find((x) => x.type === "function" && x.name === decoded.functionName) as { outputs?: unknown[] };
      if (!frag?.outputs?.length) return "0x";
      return encodeFunctionResult({ abi: c.abi, functionName: decoded.functionName, result: out } as never);
    },
    async estimateGas({ to }) {
      calls.push({ method: "eth_estimateGas", args: to });
      return 50_000n;
    },
    async blockNumber() {
      return 1234n;
    },
    async getLogs() {
      return [];
    },
  };

  const verifiedRows: Record<string, VerifiedSource> = {
    [TOKEN.toLowerCase()]: shapeVerifiedSource(
      TOKEN,
      {
        matchType: "full",
        contractName: "Token.sol:Token",
        compilerVersion: "v0.8.26+commit.8a97fa7a",
        sourceHash: "h",
        source: opts.natspecSource ?? "// SPDX-License-Identifier: MIT\ncontract Token {}\n",
        abi: JSON.stringify(TOKEN_ABI),
        verifiedAt: "2026-11-01T00:00:00Z",
      },
      true,
    ),
    [IMPL.toLowerCase()]: shapeVerifiedSource(
      IMPL,
      { matchType: "full", contractName: "Staking.sol:Staking", compilerVersion: "v0.8.26", sourceHash: "h2", source: "contract Staking {}", abi: JSON.stringify(IMPL_ABI), verifiedAt: "2026-11-01T00:00:00Z" },
      true,
    ),
  };

  const deps: ContractModuleDeps = {
    reader,
    verified: async (a) => verifiedRows[a.toLowerCase()] ?? shapeVerifiedSource(a, null, true),
    label: () => null,
    forwarder: () => (opts.forwarder === undefined ? FORWARDER : opts.forwarder),
    gasPrice: async () => 1_000_000_000n,
    payableThresholdWei: () => 10n ** 18n,
    now: () => new Date("2026-11-07T12:00:00Z"),
  };
  return { reader, deps, calls, balances, contracts, verifiedRows };
}

/** A recording fake wallet (tests only): counts every signature request. */
export function fakeWallet() {
  const sent: Array<{ chainId: number; to: Address; data: Hex; value: bigint }> = [];
  const sponsored: Array<{ to: Address; data: Hex; value: bigint }> = [];
  return {
    sent,
    sponsored,
    signer: {
      async sendTransaction(tx: { chainId: number; to: Address; data: Hex; value: bigint }) {
        sent.push(tx);
        return `0x${"ab".repeat(32)}` as Hex;
      },
      async sponsor(tx: { to: Address; data: Hex; value: bigint }) {
        sponsored.push(tx);
        return `0x${"cd".repeat(32)}` as Hex;
      },
    },
  };
}

export const encodeWord = (types: string, v: unknown) => encodeAbiParameters([{ type: types }], [v as never]);

/**
 * Prepare a write against the fake chain through the ONE preparation path the
 * dialog, the contract page and the agent share (kit prepareFromRequest).
 */
export async function kitPrepare(
  f: ReturnType<typeof fakeChain>,
  req: { address?: Address; function: string; args: unknown[]; value?: string; from?: Address | null; now?: () => number },
) {
  const [{ prepareFromRequest }, { createStoreInfoSource }] = await Promise.all([import("@/lib/contract/request"), import("@/lib/contract/infoSources")]);
  const out = await prepareFromRequest({
    reader: f.reader,
    info: createStoreInfoSource((a) => f.deps.verified(a)),
    request: { address: req.address ?? TOKEN, function: req.function, args: req.args, value: req.value },
    from: req.from === undefined ? ALICE : req.from,
    forwarder: f.deps.forwarder(),
    payableThresholdWei: f.deps.payableThresholdWei(),
    now: req.now,
  });
  return out.prepared;
}

/** A user gesture is active (the dialog's click handler), for kit approveWrite in node tests. */
export const ACTIVATED = { hasUserActivation: () => true } as const;
/** No user gesture (code running outside a click). */
export const NOT_ACTIVATED = { hasUserActivation: () => false } as const;
