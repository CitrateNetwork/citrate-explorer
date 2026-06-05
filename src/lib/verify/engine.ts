/**
 * Contract verification engine (WS-2b) — recompile-and-diff.
 *
 * Flow: normalize the submitted source into a Solidity standard-JSON input →
 * compile with the EXACT requested solc version (solc-js) → read the on-chain
 * deployed bytecode → mask immutables + strip CBOR metadata → compare each
 * compiled contract against the chain. On a match we persist the verified source
 * + ABI so the contract page can render decoded Read/Write and the source.
 *
 * Honest by construction (Rule 11): we only mark "pass" when bytecode actually
 * matches; everything else is a "fail" with the real compiler/diff reason.
 *
 * Server-only (uses solc, RPC, and the DB).
 */
import { createHash } from "crypto";
import type { Address } from "viem";
import { getContractCode } from "@/lib/harness/ops";
import { getDb } from "@/lib/db/client";
import { contractVerifications } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { compileSolidity, type CompiledContract } from "./compile";
import { matchBytecode, type MatchKind } from "./bytecode";

const MAX_SOURCE_BYTES = 2_000_000; // 2 MB — bound untrusted input

export interface VerifyInput {
  guid: string;
  address: Address;
  format: string; // solidity-standard-json-input | solidity-single-file | metadata
  compilerVersion: string;
  source: string;
  optimizationRuns?: number;
  evmVersion?: string;
}

export interface VerifyOutcome {
  guid: string;
  address: string;
  status: "pass" | "fail";
  matchType?: MatchKind;
  contractName?: string;
  compiler?: string;
  message: string;
}

const OUTPUT_SELECTION = { "*": { "*": ["abi", "evm.deployedBytecode"] } };

/** Build a Solidity standard-JSON input from whatever the user submitted. */
function buildInput(req: VerifyInput): object {
  if (req.format === "solidity-standard-json-input") {
    const parsed = JSON.parse(req.source) as { settings?: Record<string, unknown> };
    // Force the output we need regardless of what the user selected.
    parsed.settings = { ...(parsed.settings ?? {}), outputSelection: OUTPUT_SELECTION };
    return parsed;
  }
  // single-file (flattened) — wrap it.
  return {
    language: "Solidity",
    sources: { "Contract.sol": { content: req.source } },
    settings: {
      optimizer: { enabled: (req.optimizationRuns ?? 0) > 0, runs: req.optimizationRuns ?? 200 },
      ...(req.evmVersion ? { evmVersion: req.evmVersion } : {}),
      outputSelection: OUTPUT_SELECTION,
    },
  };
}

/** Run verification, persist the result, and return the outcome. */
export async function verifyContract(req: VerifyInput): Promise<VerifyOutcome> {
  if (Buffer.byteLength(req.source, "utf8") > MAX_SOURCE_BYTES) {
    return persist(req, { status: "fail", message: "source exceeds the 2 MB limit" });
  }

  let input: object;
  try {
    input = buildInput(req);
  } catch (e) {
    return persist(req, { status: "fail", message: `could not parse the source: ${(e as Error).message}` });
  }

  const onChain = await getContractCode(req.address);
  if (!onChain.isContract) {
    return persist(req, { status: "fail", message: "address has no contract code (EOA)" });
  }

  let output;
  try {
    output = await compileSolidity(req.compilerVersion, input);
  } catch (e) {
    return persist(req, { status: "fail", message: `compile failed: ${(e as Error).message}` });
  }

  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) {
    const msg = errors[0].formattedMessage ?? errors[0].message ?? "compilation error";
    return persist(req, { status: "fail", compiler: output.compiler, message: `compilation error: ${msg.split("\n")[0]}` });
  }

  // Diff every compiled contract; prefer a full match, accept a partial.
  let best: { name: string; match: MatchKind; abi: unknown[] } | null = null;
  for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
    for (const [name, contract] of Object.entries(contracts)) {
      const c = contract as CompiledContract;
      const dep = c.evm?.deployedBytecode;
      if (!dep?.object) continue;
      const m = matchBytecode(dep.object, onChain.bytecode, dep.immutableReferences);
      if (m === "full") {
        best = { name: `${file}:${name}`, match: m, abi: c.abi };
        break;
      }
      if (m === "partial" && !best) best = { name: `${file}:${name}`, match: m, abi: c.abi };
    }
    if (best?.match === "full") break;
  }

  if (!best) {
    return persist(req, {
      status: "fail",
      compiler: output.compiler,
      message: "compiled successfully, but no contract's bytecode matched the on-chain code (check the compiler version, optimizer runs, and that this is the right source).",
    });
  }

  return persist(
    req,
    {
      status: "pass",
      matchType: best.match,
      contractName: best.name,
      compiler: output.compiler,
      message: `${best.match === "full" ? "Full" : "Partial"} match — source verified.`,
    },
    { abi: JSON.stringify(best.abi), contractName: best.name },
  );
}

async function persist(
  req: VerifyInput,
  outcome: Omit<VerifyOutcome, "guid" | "address">,
  extra?: { abi?: string; contractName?: string },
): Promise<VerifyOutcome> {
  const db = getDb();
  const row = {
    guid: req.guid,
    address: req.address.toLowerCase(),
    status: outcome.status,
    matchType: outcome.matchType ?? null,
    compilerVersion: outcome.compiler ?? req.compilerVersion,
    sourceHash: createHash("sha256").update(req.source).digest("hex"),
    contractName: extra?.contractName ?? outcome.contractName ?? null,
    source: outcome.status === "pass" ? req.source : null,
    abi: extra?.abi ?? null,
    message: outcome.message,
    verifiedAt: outcome.status === "pass" ? new Date() : null,
  };
  if (db) {
    await db
      .insert(contractVerifications)
      .values(row)
      .onConflictDoUpdate({ target: contractVerifications.guid, set: row });
  }
  return { guid: req.guid, address: req.address, ...outcome };
}

/** The poll record for a guid. */
export async function getVerificationByGuid(guid: string) {
  const db = getDb();
  if (!db) return null;
  const [row] = await db.select().from(contractVerifications).where(eq(contractVerifications.guid, guid)).limit(1);
  return row ?? null;
}

/** The latest PASSED verification for an address (for the contract page). */
export async function getVerifiedContract(address: string) {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(contractVerifications)
    .where(and(eq(contractVerifications.address, address.toLowerCase()), eq(contractVerifications.status, "pass")))
    .orderBy(desc(contractVerifications.verifiedAt))
    .limit(1);
  return row ?? null;
}
