import { describe, it, expect } from "vitest";
import { boundStandardInput, InputTooLarge } from "./inputbound";

/**
 * FWA-C12-03 (RED→GREEN): untrusted Solidity standard-JSON input must be BOUNDED
 * before it ever reaches the in-process solc compiler — a compile-bomb (thousands
 * of sources / megabytes of content / a deep import fan-out) must be REJECTED
 * up-front, not handed to solc to chew on. (Full microVM isolation — the Vercel
 * Sandbox — is the deeper hardening tracked as WS-2b; this is the in-repo bound.)
 */
describe("boundStandardInput (FWA-C12-03 — compile-bomb bounding)", () => {
  const good = {
    language: "Solidity",
    sources: { "A.sol": { content: "contract A {}" } },
  };

  it("passes a normal, small input through unchanged", () => {
    expect(() => boundStandardInput(good)).not.toThrow();
  });

  it("REJECTS an input with too many source files (compile-bomb fan-out)", () => {
    const sources: Record<string, { content: string }> = {};
    for (let i = 0; i < 1000; i++) sources[`F${i}.sol`] = { content: "contract X {}" };
    expect(() => boundStandardInput({ language: "Solidity", sources })).toThrow(InputTooLarge);
  });

  it("REJECTS an input whose total source content exceeds the byte cap", () => {
    const huge = "x".repeat(5 * 1024 * 1024); // 5 MB in a single file
    expect(() =>
      boundStandardInput({ language: "Solidity", sources: { "Big.sol": { content: huge } } }),
    ).toThrow(InputTooLarge);
  });

  it("REJECTS a pathological optimizer-runs blowup", () => {
    expect(() =>
      boundStandardInput({
        language: "Solidity",
        sources: good.sources,
        settings: { optimizer: { enabled: true, runs: 10_000_000_000 } },
      }),
    ).toThrow(InputTooLarge);
  });

  it("REJECTS a source entry that uses a URL (out-of-band fetch) even alongside content", () => {
    // solc standard-JSON allows `urls`; that would make solc fetch external files.
    // We only permit inline `content` — reject `urls` even when content is also
    // present (so the urls-reject is the load-bearing check, not the content one).
    expect(() =>
      boundStandardInput({
        language: "Solidity",
        sources: {
          "Remote.sol": { content: "contract R {}", urls: ["https://evil.example/x.sol"] },
        },
      }),
    ).toThrow(InputTooLarge);
  });

  it("REJECTS non-Solidity language inputs", () => {
    expect(() => boundStandardInput({ language: "Yul", sources: good.sources })).toThrow(InputTooLarge);
  });

  it("REJECTS a missing/empty sources map", () => {
    expect(() => boundStandardInput({ language: "Solidity", sources: {} })).toThrow(InputTooLarge);
    expect(() => boundStandardInput({ language: "Solidity" })).toThrow(InputTooLarge);
  });
});
