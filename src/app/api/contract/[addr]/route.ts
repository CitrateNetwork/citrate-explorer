import type { Address } from "viem";
import { getAddress, getContractCode, getToken } from "@/lib/harness/ops";
import { getVerifiedContract } from "@/lib/verify/engine";

/**
 * Contract page data: confirms the address holds bytecode and returns the REAL
 * on-chain facts — deployed bytecode (size, code hash, raw), a known-address
 * label, and auto-detected token metadata (ERC-20/721). Source verification +
 * decoded Read/Write land via the verify engine (WS-2b) and S-5. Verify any
 * address with eth_getCode before treating it as a contract (Rule 11).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ addr: string }> },
) {
  const { addr } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return Response.json({ error: "invalid address" }, { status: 400 });
  }
  try {
    const address = addr as Address;
    const [info, code] = await Promise.all([getAddress(address), getContractCode(address)]);
    if (!info.isContract) {
      return Response.json({
        address: info.address,
        isContract: false,
        codeSize: 0,
        balanceSalt: info.balanceSalt,
        note: "Externally-owned account (EOA): no contract code.",
      });
    }
    // Best-effort token detection (cheap no-ops if it isn't a token).
    let token = null;
    try {
      const t = await getToken(address);
      if (t.standard !== "unknown") token = t;
    } catch {
      /* not a token */
    }
    // Verified source/ABI, if this contract has been verified (WS-2b).
    const verified = await getVerifiedContract(info.address).catch(() => null);
    return Response.json({
      address: info.address,
      label: code.label,
      isContract: true,
      codeSize: code.sizeBytes,
      codeHash: code.codeHash,
      bytecode: code.bytecode,
      balanceSalt: info.balanceSalt,
      token,
      verification: verified
        ? {
            verified: true,
            matchType: verified.matchType,
            contractName: verified.contractName,
            compilerVersion: verified.compilerVersion,
            source: verified.source,
            abi: verified.abi ? JSON.parse(verified.abi) : null,
            verifiedAt: verified.verifiedAt,
          }
        : {
            verified: false,
            note: "Not verified. Submit source at POST /api/verify (recompile-and-diff). Bytecode + read calls are available now.",
          },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
