/**
 * Verify worker compile child (EXP-S2). One process per compile, forked by
 * src/lib/verify/sandbox.ts with a heap cap; the parent also enforces a wall-clock
 * timeout and an RSS cap and SIGKILLs this process when either trips.
 *
 * Receives { binaryPath, keccak256, input } over IPC, re-checks the soljson file's
 * keccak256 (the parent verified it against the release list) BEFORE evaluating
 * it, compiles the standard JSON input, and sends back { ok, output | error }.
 * It does no network or database I/O.
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { keccak256 } from "viem";

const require = createRequire(import.meta.url);
const wrap = require("solc/wrapper");

process.on("message", (msg) => {
  try {
    const bytes = new Uint8Array(readFileSync(msg.binaryPath));
    const got = keccak256(bytes);
    if (got.toLowerCase() !== String(msg.keccak256).toLowerCase()) {
      process.send({ ok: false, code: "integrity", error: `solc integrity check failed: expected ${msg.keccak256}, got ${got}` });
      return;
    }
    const mod = { exports: {} };
    // The Emscripten prelude reads __dirname/__filename. It is given no `require`.
    new Function("module", "exports", "__dirname", "__filename", new TextDecoder().decode(bytes))(
      mod,
      mod.exports,
      dirname(msg.binaryPath),
      msg.binaryPath,
    );
    const solc = wrap(mod.exports);
    const output = solc.compile(JSON.stringify(msg.input));
    process.send({ ok: true, output });
  } catch (e) {
    process.send({ ok: false, code: "crash", error: String(e && e.message ? e.message : e) });
  }
});
