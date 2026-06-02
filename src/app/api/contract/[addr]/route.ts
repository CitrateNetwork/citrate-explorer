import type { Address } from "viem";
import { getAddress } from "@/lib/harness/ops";

/**
 * Contract page baseline: confirms the address holds bytecode and reports
 * verification status. Decoded Read/Write tabs + verified-source rendering land
 * in S-4 (verification) and S-5 (read/write). Verify any address with eth_getCode
 * before treating it as a contract (Rule 11).
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
    const info = await getAddress(addr as Address);
    return Response.json({
      address: info.address,
      isContract: info.isContract,
      codeSize: info.codeSize,
      balanceSalt: info.balanceSalt,
      verification: {
        verified: false,
        note: "Source verification + decoded read/write tabs land in S-4/S-5.",
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
