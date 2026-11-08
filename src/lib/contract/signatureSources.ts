/**
 * Inputs to the bundled signature subset (EXP-S3): the ABIs the explorer already
 * ships (forwarder, ERC-20/721 read surfaces, AgentSBT/OrganizationSBT) plus the
 * curated standard set. `pnpm contract:signatures` writes the result to
 * src/generated/signatures.json; signatures.test.ts keeps it in sync.
 */
import { parseAbi, type AbiItem } from "viem";
import { erc20Abi, erc721Abi, forwarderAbi } from "@/lib/citrate/abi";
import { AGENT_SBT_ABI, AGENT_TRANSFER_EVENT, ORG_SBT_ABI } from "@/lib/citrate/agentSbt";
import { STANDARD_SIGNATURES } from "./standardSignatures";

export function knownAbiItems(): AbiItem[] {
  return [
    ...(forwarderAbi as readonly AbiItem[]),
    ...(erc20Abi as readonly AbiItem[]),
    ...(erc721Abi as readonly AbiItem[]),
    ...(AGENT_SBT_ABI as readonly AbiItem[]),
    AGENT_TRANSFER_EVENT as AbiItem,
    ...(ORG_SBT_ABI as readonly AbiItem[]),
    ...(parseAbi(STANDARD_SIGNATURES as string[]) as readonly AbiItem[]),
  ];
}
