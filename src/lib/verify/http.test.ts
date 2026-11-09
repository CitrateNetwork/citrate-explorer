import { describe, it, expect } from "vitest";
import { maxBodyBytes } from "./http";

/**
 * Vercel refuses request bodies over 4.5 MB before the function runs, with a plain-text
 * 413 that Etherscan clients cannot parse. The verification routes therefore cap the body
 * below that, so an oversized submission gets an Etherscan-style JSON refusal instead.
 */
const VERCEL_BODY_LIMIT = 4.5 * 1000 * 1000;

describe("verification request body cap", () => {
  it("stays below Vercel's 4.5 MB function body limit by default", () => {
    expect(maxBodyBytes()).toBeLessThan(VERCEL_BODY_LIMIT);
  });

  it("an oversized form submission gets an Etherscan-style JSON 413, not a crash", async () => {
    const { POST } = await import("@/app/api/route");
    const big = "module=contract&action=verifysourcecode&sourceCode=" + "a".repeat(VERCEL_BODY_LIMIT - 200_000);
    const res = await POST(
      new Request("https://explorer.citrate.ai/api", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.250" },
        body: big,
      }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ status: "0", message: "NOTOK", result: "request body is too large" });
  });
});
