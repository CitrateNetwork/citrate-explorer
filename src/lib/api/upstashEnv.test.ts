import { describe, it, expect, vi, afterEach } from "vitest";
import { upstashRestEnv } from "./upstashEnv";
import { compileGateFromEnv } from "@/lib/verify/concurrency";

afterEach(() => vi.unstubAllEnvs());

function setEnv(env: Record<string, string>) {
  for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "KV_REST_API_READ_ONLY_TOKEN"]) {
    vi.stubEnv(k, env[k] ?? "");
  }
}

describe("upstashRestEnv: one store's URL and token, resolved as a pair", () => {
  it("prefers the UPSTASH_REDIS_REST_* pair when both are set", () => {
    setEnv({ UPSTASH_REDIS_REST_URL: "https://a.upstash.io", UPSTASH_REDIS_REST_TOKEN: "ta", KV_REST_API_URL: "https://b.upstash.io", KV_REST_API_TOKEN: "tb" });
    expect(upstashRestEnv()).toEqual({ url: "https://a.upstash.io", token: "ta" });
  });

  it("uses the Vercel Marketplace KV_REST_API_* pair when the UPSTASH_* pair is unset", () => {
    setEnv({ KV_REST_API_URL: "https://b.upstash.io", KV_REST_API_TOKEN: "tb" });
    expect(upstashRestEnv()).toEqual({ url: "https://b.upstash.io", token: "tb" });
  });

  it("never pairs one store's URL with the other store's token", () => {
    setEnv({ UPSTASH_REDIS_REST_URL: "https://a.upstash.io", KV_REST_API_TOKEN: "tb" });
    expect(upstashRestEnv()).toBeNull();
    setEnv({ UPSTASH_REDIS_REST_URL: "https://a.upstash.io", KV_REST_API_URL: "https://b.upstash.io", KV_REST_API_TOKEN: "tb" });
    expect(upstashRestEnv()).toEqual({ url: "https://b.upstash.io", token: "tb" });
  });

  it("never uses the read-only token", () => {
    setEnv({ KV_REST_API_URL: "https://b.upstash.io", KV_REST_API_READ_ONLY_TOKEN: "ro" });
    expect(upstashRestEnv()).toBeNull();
  });
});

describe("compileGateFromEnv: the global compile cap finds the Marketplace store", () => {
  it("is distributed with only the KV_REST_API_* names set", () => {
    setEnv({ KV_REST_API_URL: "https://b.upstash.io", KV_REST_API_TOKEN: "tb" });
    expect(compileGateFromEnv(2).distributed).toBe(true);
  });
});
