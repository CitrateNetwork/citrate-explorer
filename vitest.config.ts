import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // live-RPC integration tests can take a few seconds
    testTimeout: 20_000,
    // Each PGlite-backed file boots Postgres (WASM) and applies every migration in
    // beforeAll; with many such files starting in parallel that takes over 10 s.
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
