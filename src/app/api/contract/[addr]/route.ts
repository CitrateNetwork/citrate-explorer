import type { Address } from "viem";
import { getAddress, getContractCode, getToken } from "@/lib/harness/ops";

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
    return Response.json({
      address: info.address,
      label: code.label,
      isContract: true,
      codeSize: code.sizeBytes,
      codeHash: code.codeHash,
      bytecode: code.bytecode,
      balanceSalt: info.balanceSalt,
      token,
      verification: {
        verified: false,
        note: "Source verification (recompile-and-diff) lands with the verify engine (WS-2b). Bytecode + behavior (via read calls) are available now.",
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
