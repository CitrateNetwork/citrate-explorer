import { getDagBlock, dagStats } from "@/lib/citrate/rpc";
import { harnessClient } from "@/lib/harness/client";
import { clientIp } from "@/lib/api/keys";
import { checkRateLimit } from "@/lib/api/ratelimit";
import { publicMessage } from "@/lib/api/errors";

/**
 * Live DAG stream (P-5 WP-5.1) as Server-Sent Events.
 *
 * The indexer's `wss://… eth_subscribe("newHeads")` worker is the eventual source
 * (always-on, off-Vercel). Until it's provisioned, this endpoint streams the REAL
 * frontier by polling live RPC server-side — honest chain data, never fabricated:
 * on connect it sends a snapshot of the recent blocks, then emits a `block` event
 * for each new head as the chain produces it, plus periodic `status` (tips, max
 * blue_score). The browser's EventSource reconnects natively, so we close cleanly
 * before the 300s function cap and the client resumes without a gap.
 *
 * Each vertex carries the GHOSTDAG fields the renderer needs: blue_score, the
 * selected parent, and merge parents (now that the node exposes them).
 *
 * Data source (Rule 11): live `eth_getBlockByNumber` + `citrate_getDagStats`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SNAPSHOT_N = 14;
const POLL_MS = 2500;
const STATUS_EVERY = 4; // emit fresh stats every Nth poll
const MAX_STREAM_MS = 250_000; // close before the 300s cap → client reconnects

// FUA-EXPLORER-06: this is an UNAUTHENTICATED, long-lived (250s) RPC-polling
// connection. Cap total concurrent streams so it can't be used for connection /
// RPC-amplification DoS. Generous default; env-tunable.
// PBA-L3c-034 (d): this cap is PER INSTANCE by design: it bounds the pollers and
// memory one instance holds. The cross-instance bound is the per-IP open rate
// below, which uses the shared (Upstash) limiter when configured.
const MAX_CONCURRENT_STREAMS = Number(process.env.CITRATE_DAG_MAX_STREAMS ?? 50);
let activeStreams = 0;

interface Vertex {
  hash: string;
  height: number;
  blueScore: number;
  selectedParent: string | null;
  mergeParents: string[];
  txCount: number;
  proposer: string | null;
  timestamp: number;
}

function toVertex(b: NonNullable<Awaited<ReturnType<typeof getDagBlock>>>): Vertex {
  return {
    hash: b.hash,
    height: b.height,
    blueScore: b.blueScore,
    selectedParent: b.selectedParent ?? null,
    mergeParents: b.mergeParents ?? [],
    txCount: b.txCount,
    proposer: b.proposer,
    timestamp: b.timestamp,
  };
}

async function safeStats() {
  try {
    const s = await dagStats();
    return {
      maxBlueScore: s.maxBlueScore,
      tipsCount: s.tipsCount,
      tips: s.currentTips ?? [],
      height: s.height,
      finalityDepth: s.ghostdagParams.finalityDepth,
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  // FUA-EXPLORER-06: rate-limit opens per trusted IP, then cap total concurrent
  // streams — refuse with 429/503 rather than open another 250s RPC-poller.
  const rl = await checkRateLimit(`dagstream:${clientIp(req)}`, 0.5, 10);
  if (!rl.ok) {
    return new Response("rate limited", {
      status: 429,
      headers: { "retry-after": String(rl.retryAfter ?? 5) },
    });
  }
  if (activeStreams >= MAX_CONCURRENT_STREAMS) {
    return new Response("too many active streams", {
      status: 503,
      headers: { "retry-after": "5" },
    });
  }
  activeStreams += 1;

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const ping = () => {
        if (!closed) controller.enqueue(encoder.encode(`: ping\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        activeStreams = Math.max(0, activeStreams - 1); // FUA-EXPLORER-06: release the slot
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Client navigated away / EventSource closed.
      req.signal.addEventListener("abort", close);

      // --- initial snapshot ---
      let lastHead: number;
      try {
        lastHead = Number(await harnessClient().getBlockNumber());
        const heights: number[] = [];
        for (let i = 0; i < SNAPSHOT_N && lastHead - i >= 0; i++) heights.push(lastHead - i);
        const blocks = (await Promise.all(heights.map((h) => getDagBlock(h))))
          .filter((b): b is NonNullable<typeof b> => Boolean(b))
          .map(toVertex);
        send("snapshot", { blocks, stats: await safeStats() });
      } catch (err) {
        send("error", { message: publicMessage(err, "api.dag_stream") });
        close();
        return;
      }

      // --- poll for new heads ---
      let tick = 0;
      const timer = setInterval(async () => {
        if (closed) return;
        if (Date.now() - startedAt > MAX_STREAM_MS) return close();
        tick += 1;
        ping();
        try {
          const head = Number(await harnessClient().getBlockNumber());
          for (let h = lastHead + 1; h <= head; h++) {
            const b = await getDagBlock(h);
            if (b) send("block", toVertex(b));
          }
          lastHead = Math.max(lastHead, head);
          if (tick % STATUS_EVERY === 0) {
            const stats = await safeStats();
            if (stats) send("status", stats);
          }
        } catch {
          // Transient RPC hiccup — keep the stream open; next tick retries.
        }
      }, POLL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
