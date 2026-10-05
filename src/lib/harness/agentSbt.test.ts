import { describe, it, expect } from "vitest";
import { createPublicClient, http, type PublicClient } from "viem";
import { readOwner } from "./agentSbt";

describe("AgentSBT readOwner", () => {
  it("rethrows a transport failure instead of reporting no owner", async () => {
    // Port 1 on loopback refuses connections: a real unreachable node, not a stub.
    const dead = createPublicClient({ transport: http("http://127.0.0.1:1", { retryCount: 0, timeout: 2_000 }) }) as PublicClient;
    await expect(
      readOwner({ client: dead, address: "0xd16b1ad6e744f3e92223c65f492c35d36ae07c7b" }, 0n),
    ).rejects.toThrow();
  });
});
