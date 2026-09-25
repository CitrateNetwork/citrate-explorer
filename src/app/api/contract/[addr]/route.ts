import type { Address } from "viem";
import { getAddress, getContractCode, getToken } from "@/lib/harness/ops";
import { getVerifiedContract } from "@/lib/verify/engine";
import { verificationBadge } from "@/lib/verify/badge";
import { publicMessage } from "@/lib/api/errors";
import { limitPublicRead } from "@/lib/api/publicRead";

/**
 * Contract page data: confirms the address holds bytecode and returns the REAL
 * on-chain facts — deployed bytecode (size, code hash, raw), a known-address
 * label, and auto-detected token metadata (ERC-20/721). Source verification +
 * decoded Read/Write land via the verify engine (WS-2b) and S-5. Verify any
 * address with eth_getCode before treating it as a contract (Rule 11).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ addr: string }> },
) {
  // PBA-L3c-019: shared per-IP budget for public reads.
  const limited = await limitPublicRead(req);
  if (limited) return limited;
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
    // Verified source/ABI, if this contract has a recorded match (WS-2b).
    // FWA-C12-05: a PARTIAL match (metadata-stripped) is NOT "verified" — the
    // badge decision is centralized in verificationBadge() so the green shield is
    // granted only on a full/exact match. A partial match still surfaces the
    // recompiled source/ABI, but clearly labeled as a partial (not-verified) match.
    const matched = await getVerifiedContract(info.address).catch(() => null);
    const badge = matched ? verificationBadge(matched.matchType) : null;
    return Response.json({
      address: info.address,
      label: code.label,
      isContract: true,
      codeSize: code.sizeBytes,
      codeHash: code.codeHash,
      bytecode: code.bytecode,
      balanceSalt: info.balanceSalt,
      token,
      verification: matched && badge
        ? {
            verified: badge.verified,
            status: badge.status,
            matchLabel: badge.label,
            matchType: matched.matchType,
            contractName: matched.contractName,
            compilerVersion: matched.compilerVersion,
            source: matched.source,
            abi: matched.abi ? JSON.parse(matched.abi) : null,
            verifiedAt: matched.verifiedAt,
            ...(badge.verified
              ? {}
              : {
                  note: "Partial match only: the recompiled runtime bytecode matches after stripping CBOR metadata, but the metadata hash (which commits to the exact source + compiler settings) does NOT match. Source shown for reference; this is NOT a verified match.",
                }),
          }
        : {
            verified: false,
            status: "unverified",
            note: "Not verified. Submit source at POST /api/verify (recompile-and-diff). Bytecode + read calls are available now.",
          },
    });
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.contract") }, { status: 502 });
  }
}
