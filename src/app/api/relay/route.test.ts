import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/relay", () => {
  it("rejects attacker-selected native value before any relayer or chain access", async () => {
    const response = await POST(
      new Request("http://localhost/api/relay", {
        method: "POST",
        body: JSON.stringify({
          request: {
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            value: "1",
            gas: "200000",
            nonce: "0",
            deadline: 4_000_000_000,
            data: "0x",
          },
          signature: `0x${"00".repeat(65)}`,
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "non-zero value ForwardRequests are not supported by the gasless relay",
    });
  });

  it("rejects an excessive gas request before any relayer or chain access", async () => {
    const response = await POST(
      new Request("http://localhost/api/relay", {
        method: "POST",
        body: JSON.stringify({
          request: {
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            value: "0",
            gas: "2000001",
            nonce: "0",
            deadline: 4_000_000_000,
            data: "0x",
          },
          signature: `0x${"00".repeat(65)}`,
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "ForwardRequest gas exceeds the 2000000 limit",
    });
  });
});
