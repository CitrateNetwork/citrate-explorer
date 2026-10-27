import { searchContracts } from "@/lib/indexer/contractSearch";
import { publicMessage } from "@/lib/api/errors";
import { limitPublicRead } from "@/lib/api/publicRead";

/**
 * Contract directory: list / search deployed contracts by name or address.
 *
 *   GET /api/contracts?q=ModelRegistry&limit=25&offset=0
 *
 * `q` matches a case-insensitive substring of the contract name, or an address
 * prefix when it looks like hex (`0x…`). Empty `q` lists everything, named
 * contracts first. Pages by `offset` (`nextOffset` is null on the last page);
 * `limit` is clamped to 1..100.
 *
 * Data source (Rule 11): the `contracts` index (indexer + backfill + 40204
 * address-book labels); falls back to the vendored canonical address book when
 * the index is unprovisioned or has no match yet, and says so in `source`.
 */
export async function GET(req: Request) {
  // PBA-L3c-019: shared per-IP budget for public reads.
  const limited = await limitPublicRead(req);
  if (limited) return limited;
  const params = new URL(req.url).searchParams;
  const num = (k: string) => {
    const v = params.get(k);
    return v === null || v.trim() === "" ? undefined : Number(v);
  };
  const limit = num("limit");
  const offset = num("offset");
  if ((limit !== undefined && !Number.isFinite(limit)) || (offset !== undefined && !Number.isFinite(offset))) {
    return Response.json({ error: "limit and offset must be numbers" }, { status: 400 });
  }
  try {
    const result = await searchContracts({ q: params.get("q") ?? "", limit, offset });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.contracts") }, { status: 502 });
  }
}
