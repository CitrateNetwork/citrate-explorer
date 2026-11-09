import { describe, expect, it } from "vitest";
import { createDecompilerSource } from "./decompiler";

const ADDR = "0xaa918302b94a4b0e75e01e019cc6b819b4f7c906";
const HASH = "0x" + "12".repeat(32);

describe("decompiler: offline worker interface", () => {
  it("says the decompiler is not available when no worker is configured", async () => {
    const src = createDecompilerSource({ baseUrl: undefined });
    expect(src.configured).toBe(false);
    expect(await src.load(40204, ADDR, HASH)).toEqual({
      status: "not-available",
      reason: "No decompiler worker is deployed for this explorer yet. This panel shows output from an offline worker (heimdall-rs on the indexer host) once one is running.",
    });
  });

  it("reads a worker result and checks it is for this code hash", async () => {
    const calls: string[] = [];
    const body = { chainId: 40204, address: ADDR, codeHash: HASH, decompiler: { name: "heimdall-rs", version: "0.9.2" }, generatedAt: "2026-11-07T00:00:00Z", source: "contract Decompiled {}", abi: [] };
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const src = createDecompilerSource({ baseUrl: "https://decompiler.internal", fetch: fetchFn });
    const r = await src.load(40204, ADDR, HASH);
    expect(calls[0]).toBe(`https://decompiler.internal/v1/decompiled/40204/${ADDR}?codeHash=${HASH}`);
    expect(r).toMatchObject({ status: "ok", decompiler: { name: "heimdall-rs" }, source: "contract Decompiled {}" });

    const wrong = createDecompilerSource({ baseUrl: "https://d", fetch: (async () => new Response(JSON.stringify({ ...body, codeHash: "0x" + "00".repeat(32) }))) as unknown as typeof fetch });
    expect(await wrong.load(40204, ADDR, HASH)).toMatchObject({ status: "error" });
  });

  it("reports pending (404) and malformed results honestly", async () => {
    const notYet = createDecompilerSource({ baseUrl: "https://d", fetch: (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch });
    expect(await notYet.load(40204, ADDR, HASH)).toMatchObject({ status: "pending" });
    const junk = createDecompilerSource({ baseUrl: "https://d", fetch: (async () => new Response(JSON.stringify({ nope: 1 }))) as unknown as typeof fetch });
    expect(await junk.load(40204, ADDR, HASH)).toMatchObject({ status: "error" });
  });
});
