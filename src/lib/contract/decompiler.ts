/**
 * Offline decompiler interface (EXP-S3). The "Decompiled, not source" panel reads
 * results that an offline worker (heimdall-rs on the indexer host) produced from
 * runtime bytecode; nothing decompiles in the browser or in a web function.
 *
 * Data source (Rule 7): the worker's read endpoint, configured by
 * NEXT_PUBLIC_DECOMPILER_URL. The contract is documented in
 * .agentile/docs/DECOMPILER_WORKER_CONTRACT.md. When no worker is configured the
 * panel says so; it never shows invented output.
 */
import { z } from "zod";

export type DecompilationResult =
  | { status: "not-available"; reason: string }
  | { status: "pending"; reason: string }
  | { status: "error"; reason: string }
  | {
      status: "ok";
      decompiler: { name: string; version: string };
      generatedAt: string;
      codeHash: string;
      /** Solidity-like text. Names are guesses; this is not source. */
      source: string;
      abi: unknown[];
    };

export interface DecompilerSource {
  readonly configured: boolean;
  load(chainId: number, address: string, codeHash: string): Promise<DecompilationResult>;
}

const ResultSchema = z.object({
  chainId: z.number().int(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  decompiler: z.object({ name: z.string().min(1), version: z.string().min(1) }),
  generatedAt: z.string().min(1),
  source: z.string(),
  abi: z.array(z.unknown()),
});

const NOT_AVAILABLE =
  "No decompiler worker is deployed for this explorer yet. This panel shows output from an offline worker (heimdall-rs on the indexer host) once one is running.";

export function createDecompilerSource(opts: { baseUrl: string | undefined; fetch?: typeof fetch }): DecompilerSource {
  const baseUrl = opts.baseUrl?.replace(/\/+$/, "");
  const f = opts.fetch ?? fetch;
  return {
    configured: !!baseUrl,
    async load(chainId, address, codeHash) {
      if (!baseUrl) return { status: "not-available", reason: NOT_AVAILABLE };
      const a = address.toLowerCase();
      let res: Response;
      try {
        res = await f(`${baseUrl}/v1/decompiled/${chainId}/${a}?codeHash=${codeHash.toLowerCase()}`);
      } catch {
        return { status: "error", reason: "The decompiler worker could not be reached." };
      }
      if (res.status === 404) return { status: "pending", reason: "The worker has not decompiled this code yet. It runs offline; check back later." };
      if (!res.ok) return { status: "error", reason: `The decompiler worker answered HTTP ${res.status}.` };
      const parsed = ResultSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) return { status: "error", reason: "The decompiler worker returned a result this page cannot read." };
      const r = parsed.data;
      if (r.codeHash.toLowerCase() !== codeHash.toLowerCase() || r.address.toLowerCase() !== a || r.chainId !== chainId) {
        return { status: "error", reason: "The decompiler result is for different code than this address runs now." };
      }
      return { status: "ok", decompiler: r.decompiler, generatedAt: r.generatedAt, codeHash: r.codeHash, source: r.source, abi: r.abi };
    },
  };
}

/** The page's decompiler source, from NEXT_PUBLIC_DECOMPILER_URL. */
export function decompilerFromEnv(): DecompilerSource {
  return createDecompilerSource({ baseUrl: process.env.NEXT_PUBLIC_DECOMPILER_URL || undefined });
}
