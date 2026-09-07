import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveCompilerVersion, resolveVerifiedBuild } from "./compile";

/**
 * FWA-C12-03: the solc version string is interpolated into the soljson binaries
 * URL (an outbound-fetch sink). It must be pinned to clean semver / semver+commit
 * shapes — a crafted string with path separators, traversal, or a host must be
 * rejected BEFORE any network fetch.
 *
 * EX-B-011 / CIT-EXP-02 (RM-Q, 2026-09-07): additionally, EVERY requested build —
 * including the `+commit` form — must be validated against the release list
 * (membership), and the list's keccak256 digest is what the loader verifies. The
 * old code returned the `+commit` form synchronously WITHOUT any list lookup, so
 * an arbitrary unlisted build name reached the fetch. That behaviour is now
 * inverted: an unlisted build is rejected.
 */

const LIST = {
  releases: { "0.8.26": "soljson-v0.8.26+commit.8a97fa7a.js" },
  builds: [
    {
      path: "soljson-v0.8.26+commit.8a97fa7a.js",
      version: "0.8.26",
      build: "commit.8a97fa7a",
      longVersion: "0.8.26+commit.8a97fa7a",
      keccak256: "0x34ffb570dd3b2041e3df86cb1f9190256cd28ee5a6f3d4200fe4b9747d33f901",
    },
  ],
};

function stubList() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("list.json")) {
        return { ok: true, json: async () => LIST } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

function stubFetchThrows() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("fetch must not be reached for a malformed version");
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resolveCompilerVersion — version-shape guard (FWA-C12-03)", () => {
  it("rejects a path-traversal version WITHOUT fetching", async () => {
    stubFetchThrows();
    await expect(
      resolveCompilerVersion("../../../etc/passwd+commit.deadbeef"),
    ).rejects.toThrow(/invalid solc version/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an embedded URL/host without fetching", async () => {
    stubFetchThrows();
    await expect(
      resolveCompilerVersion("0.8.26+commit.dead/../@evil.example"),
    ).rejects.toThrow(/invalid solc version/);
  });

  it("rejects a non-hex commit and junk suffixes without fetching", async () => {
    stubFetchThrows();
    await expect(resolveCompilerVersion("0.8.26+commit.zzzz")).rejects.toThrow(/invalid solc version/);
    await expect(resolveCompilerVersion("0.8.26; rm -rf /")).rejects.toThrow(/invalid solc version/);
  });
});

describe("resolveVerifiedBuild — release-list membership + integrity (EX-B-011)", () => {
  it("resolves a bare semver via the release list and returns its keccak256", async () => {
    stubList();
    const r = await resolveVerifiedBuild("0.8.26");
    expect(r.build).toBe("v0.8.26+commit.8a97fa7a");
    expect(r.keccak256).toMatch(/^0x34ffb570/);
  });

  it("resolves a LISTED +commit build (membership-checked, no longer a bypass)", async () => {
    stubList();
    const r = await resolveVerifiedBuild("v0.8.26+commit.8a97fa7a");
    expect(r.build).toBe("v0.8.26+commit.8a97fa7a");
  });

  it("REJECTS an unlisted +commit build (the closed bypass)", async () => {
    stubList();
    await expect(resolveVerifiedBuild("0.8.26+commit.deadbeef")).rejects.toThrow(
      /unknown\/unlisted solc build/,
    );
  });

  it("REJECTS an unlisted bare semver", async () => {
    stubList();
    await expect(resolveVerifiedBuild("0.9.99")).rejects.toThrow(/unknown\/unlisted solc build/);
  });
});

describe("resolveVerifiedBuild — optional allowlist (fail-closed)", () => {
  it("rejects a version outside CITRATE_VERIFY_ALLOWED_COMPILERS before fetching", async () => {
    stubFetchThrows();
    vi.stubEnv("CITRATE_VERIFY_ALLOWED_COMPILERS", "0.8.30,0.8.31");
    await expect(resolveVerifiedBuild("0.8.26")).rejects.toThrow(/not in CITRATE_VERIFY_ALLOWED_COMPILERS/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows a version that IS in the allowlist", async () => {
    stubList();
    vi.stubEnv("CITRATE_VERIFY_ALLOWED_COMPILERS", "0.8.26");
    const r = await resolveVerifiedBuild("0.8.26");
    expect(r.build).toBe("v0.8.26+commit.8a97fa7a");
  });
});
