import { getVerificationByGuid } from "@/lib/verify/engine";

/** Poll a verification by guid — the persisted recompile-and-diff result. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ guid: string }> },
) {
  const { guid } = await ctx.params;
  const row = await getVerificationByGuid(guid);
  if (!row) {
    return Response.json(
      { guid, status: "unknown", message: "No verification found for this guid (or no DB provisioned)." },
      { status: 404 },
    );
  }
  return Response.json({
    guid: row.guid,
    address: row.address,
    status: row.status,
    matchType: row.matchType,
    contractName: row.contractName,
    compilerVersion: row.compilerVersion,
    message: row.message,
    verifiedAt: row.verifiedAt,
  });
}
