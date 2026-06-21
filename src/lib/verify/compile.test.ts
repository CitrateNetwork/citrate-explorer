import { describe, it, expect } from "vitest";
import { resolveCompilerVersion } from "./compile";

/**
 * FWA-C12-03: the solc version string is interpolated into the soljson binaries
 * URL (an outbound-fetch sink). It must be pinned to clean semver / semver+commit
 * shapes — a crafted string with path separators, traversal, or a host must be
 * rejected BEFORE any network fetch. The +commit fast-path returns synchronously
 * (no fetch), so these reject without touching the network.
 */
describe("resolveCompilerVersion — version-shape guard (FWA-C12-03)", () => {
  it("accepts a clean semver+commit (fast path, no fetch)", async () => {
    await expect(resolveCompilerVersion("v0.8.26+commit.8a97fa7a")).resolves.toBe(
      "v0.8.26+commit.8a97fa7a",
    );
  });

  it("rejects a path-traversal version without fetching", async () => {
    await expect(
      resolveCompilerVersion("../../../etc/passwd+commit.deadbeef"),
    ).rejects.toThrow(/invalid solc version/);
  });

  it("rejects an embedded URL/host", async () => {
    await expect(
      resolveCompilerVersion("0.8.26+commit.dead/../@evil.example"),
    ).rejects.toThrow(/invalid solc version/);
  });

  it("rejects a non-hex commit and junk suffixes", async () => {
    await expect(resolveCompilerVersion("0.8.26+commit.zzzz")).rejects.toThrow(/invalid solc version/);
    await expect(resolveCompilerVersion("0.8.26; rm -rf /")).rejects.toThrow(/invalid solc version/);
  });
});
