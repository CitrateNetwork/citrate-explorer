/** Poll a verification by guid. The engine (recompile-and-diff) lands in S-4. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ guid: string }> },
) {
  const { guid } = await ctx.params;
  return Response.json({
    guid,
    status: "pending",
    message:
      "Verification engine ships in S-4 (multi-version solc recompile-and-diff " +
      "in a sandbox, with proxy detection). This endpoint will then report " +
      "pass/fail and full vs partial match.",
  });
}
