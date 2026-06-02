import type { Address } from "viem";
import { getChainStatus, getAddress } from "@/lib/harness/ops";

/**
 * Etherscan-compatible REST surface: `/api/v1?module=&action=&...&apikey=`.
 * Returns the Etherscan envelope `{ status, message, result }` so existing
 * tooling (Hardhat/Foundry verify plugins, scripts) works against CitrateScan.
 *
 * This skeleton wires a few real actions; the full module set + API-key gating
 * + rate limiting land in S-6 (see EXPLORER_SPEC.md §3).
 */
const ok = (result: unknown) =>
  Response.json({ status: "1", message: "OK", result });
const fail = (message: string, result: unknown = null) =>
  Response.json({ status: "0", message, result });

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const moduleName = p.get("module");
  const action = p.get("action");

  try {
    if (moduleName === "proxy" && action === "eth_blockNumber") {
      const s = await getChainStatus();
      return ok(`0x${BigInt(s.blockNumber).toString(16)}`);
    }
    if (moduleName === "account" && action === "balance") {
      const address = p.get("address");
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return fail("invalid address");
      }
      const info = await getAddress(address as Address);
      return ok(info.balanceWei); // wei (grains), Etherscan-style
    }
    if (moduleName === "gastracker" && action === "gasoracle") {
      const s = await getChainStatus();
      const gwei = (Number(s.gasPriceWei) / 1e9).toString();
      return ok({ SafeGasPrice: gwei, ProposeGasPrice: gwei, FastGasPrice: gwei });
    }

    return fail(
      `Unsupported or not-yet-implemented module/action: ${moduleName}/${action}. ` +
        "Full Etherscan-compatible coverage + API keys land in S-6.",
    );
  } catch (err) {
    return fail((err as Error).message);
  }
}
