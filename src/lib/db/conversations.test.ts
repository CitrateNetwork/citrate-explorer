import { describe, it, expect } from "vitest";
import {
  createThread,
  createThreadWithId,
  listThreads,
  getThreadMessages,
  ownsThread,
  renameThread,
  deleteThread,
} from "./conversations";

// No DATABASE_URL in the test env → every op must degrade gracefully (no throw),
// so the agent keeps working without persistence.
describe("conversations — graceful without a DB", () => {
  it("createThread returns null", async () => expect(await createThread("0xabc")).toBeNull());
  it("createThreadWithId returns null", async () => expect(await createThreadWithId("0xabc", "t1")).toBeNull());
  it("listThreads returns []", async () => expect(await listThreads("0xabc")).toEqual([]));
  it("getThreadMessages returns []", async () => expect(await getThreadMessages("0xabc", "t1")).toEqual([]));
  it("ownsThread returns false", async () => expect(await ownsThread("0xabc", "t1")).toBe(false));
  it("renameThread / deleteThread return false", async () => {
    expect(await renameThread("0xabc", "t1", "x")).toBe(false);
    expect(await deleteThread("0xabc", "t1")).toBe(false);
  });
});
