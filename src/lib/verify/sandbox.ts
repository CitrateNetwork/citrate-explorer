/**
 * Isolated compile for the verify worker (EXP-S2). Each compile runs in a fresh
 * child process (scripts/verify/compile-child.mjs) so untrusted Solidity never
 * compiles inside a web function or the worker's own heap:
 *   - wall-clock timeout (CITRATE_VERIFY_COMPILE_TIMEOUT_MS, default 120 s), then SIGKILL;
 *   - resident-memory cap (CITRATE_VERIFY_COMPILE_MEMORY_MB, default 2048), sampled every
 *     200 ms, then SIGKILL. solc's WASM heap lives outside V8's old space, so RSS is
 *     the number that matters; the child also gets --max-old-space-size;
 *   - output cap (CITRATE_VERIFY_COMPILE_MAX_OUTPUT_MB, default 64);
 *   - the soljson build is verified against the release list's keccak256 by the
 *     parent (./compile.ts) and again by the child before it is evaluated.
 *
 * Data source: the official solc release list and binaries (./compile.ts).
 */
import { fork, execFile } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { ensureVerifiedBinary, type CompileOutput } from "./compile";

export interface CompileLimits {
  timeoutMs: number;
  memoryMb: number;
  maxOutputBytes: number;
}

function intEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function compileLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): CompileLimits {
  return {
    timeoutMs: intEnv(env.CITRATE_VERIFY_COMPILE_TIMEOUT_MS, 120_000),
    memoryMb: intEnv(env.CITRATE_VERIFY_COMPILE_MEMORY_MB, 2048),
    maxOutputBytes: intEnv(env.CITRATE_VERIFY_COMPILE_MAX_OUTPUT_MB, 64) * 1024 * 1024,
  };
}

export type CompileFailureCode = "timeout" | "memory" | "output" | "integrity" | "crash";

export class CompileFailure extends Error {
  constructor(
    readonly code: CompileFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "CompileFailure";
  }
}

// __dirname works under both tsx (the worker, CommonJS) and vitest.
const CHILD = join(__dirname, "..", "..", "..", "scripts", "verify", "compile-child.mjs");

async function rssKb(pid: number): Promise<number | null> {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(status);
    if (m) return Number(m[1]);
  } catch {
    // not Linux; fall back to ps
  }
  return new Promise((resolve) => {
    execFile("ps", ["-o", "rss=", "-p", String(pid)], (err, out) => {
      const n = Number(String(out).trim());
      resolve(err || !Number.isFinite(n) ? null : n);
    });
  });
}

/** Compile `input` with a verified soljson file in a capped child process. */
export function compileFile(
  binary: { path: string; keccak256: string },
  input: object,
  limits: CompileLimits = compileLimitsFromEnv(),
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = fork(CHILD, [], {
      execArgv: [`--max-old-space-size=${limits.memoryMb}`],
      // The child evaluates a downloaded compiler: it gets none of the worker's
      // environment (DATABASE_URL, keys). It needs no variables to compile.
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "json",
    });
    let settled = false;
    const finish = (err: Error | null, out?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(watch);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (err) reject(err);
      else resolve(out as string);
    };
    const timer = setTimeout(
      () => finish(new CompileFailure("timeout", `compile exceeded ${limits.timeoutMs} ms and was stopped`)),
      limits.timeoutMs,
    );
    const watch = setInterval(async () => {
      if (child.pid === undefined || settled) return;
      const kb = await rssKb(child.pid);
      if (kb !== null && kb > limits.memoryMb * 1024) {
        finish(new CompileFailure("memory", `compile exceeded ${limits.memoryMb} MB of memory and was stopped`));
      }
    }, 200);
    child.on("message", (m: { ok: boolean; output?: string; code?: CompileFailureCode; error?: string }) => {
      if (!m.ok) return finish(new CompileFailure(m.code ?? "crash", m.error ?? "compiler failed"));
      if (typeof m.output !== "string") return finish(new CompileFailure("crash", "compiler returned no output"));
      if (Buffer.byteLength(m.output, "utf8") > limits.maxOutputBytes) {
        return finish(new CompileFailure("output", `compiler output exceeded ${limits.maxOutputBytes} bytes`));
      }
      finish(null, m.output);
    });
    child.on("error", (e) => finish(new CompileFailure("crash", e.message)));
    child.on("exit", (code, signal) => {
      if (!settled) finish(new CompileFailure("crash", `compiler process exited (${signal ?? code})`));
    });
    child.send({ binaryPath: binary.path, keccak256: binary.keccak256, input });
  });
}

/** A compiler: version + standard JSON in, parsed solc output out. */
export type Compiler = (version: string, input: object) => Promise<CompileOutput>;

/** The worker's compiler: verified binary (cached) + sandboxed child. */
export function sandboxedCompiler(limits: CompileLimits = compileLimitsFromEnv()): Compiler {
  return async (version, input) => {
    const bin = await ensureVerifiedBinary(version);
    const raw = await compileFile(bin, input, limits);
    const out = JSON.parse(raw) as Omit<CompileOutput, "compiler">;
    return { ...out, compiler: bin.build, longVersion: bin.longVersion };
  };
}
