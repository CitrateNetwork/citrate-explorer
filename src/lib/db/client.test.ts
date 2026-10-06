import { afterEach, describe, expect, it, vi } from "vitest";

const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

async function freshClient() {
  vi.resetModules();
  return import("./client");
}

describe("database TLS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies the server certificate against DATABASE_CA_CERT", async () => {
    const { dbSslOptions } = await freshClient();
    expect(dbSslOptions({ NODE_ENV: "production", DATABASE_CA_CERT: CA })).toEqual({
      ca: CA,
      rejectUnauthorized: true,
    });
  });

  it("getDb() throws in production when DATABASE_URL is set but DATABASE_CA_CERT is not", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example:25060/x");
    vi.stubEnv("DATABASE_CA_CERT", "");
    const { getDb } = await freshClient();
    expect(() => getDb()).toThrow(/DATABASE_CA_CERT/);
  });

  it("getDb() builds a verifying client in production when the CA is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example:25060/x");
    vi.stubEnv("DATABASE_CA_CERT", CA);
    const { getDb } = await freshClient();
    expect(getDb()).not.toBeNull();
  });

  it("never returns unverified TLS", async () => {
    const { dbSslOptions } = await freshClient();
    for (const env of [{ NODE_ENV: "development" }, { NODE_ENV: "test" }, { NODE_ENV: "production", DATABASE_CA_CERT: CA }]) {
      const ssl = dbSslOptions(env as NodeJS.ProcessEnv);
      if (ssl && typeof ssl === "object") expect(ssl.rejectUnauthorized).toBe(true);
    }
  });

  it("keeps the null-DB path when DATABASE_URL is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_CA_CERT", "");
    const { getDb, isDbEnabled } = await freshClient();
    expect(getDb()).toBeNull();
    expect(isDbEnabled()).toBe(false);
  });
});
