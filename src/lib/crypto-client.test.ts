import { describe, it, expect } from "vitest";
import {
  deriveSettingsKey,
  deriveBlindIndexKey,
  blindIndex,
  encryptSettings,
  decryptSettings,
} from "./crypto-client";

// crypto-client uses the Web Crypto API (globalThis.crypto.subtle), available in
// Node 20+. These assert the E2EE round-trip (WP-1.7): key derives from a wallet
// signature, ciphertext is opaque, and only the same signature recovers plaintext.
const SIG_A =
  "0x" + "ab".repeat(65); // 65-byte fake signature
const SIG_B = "0x" + "cd".repeat(65);
const ADDR = "0x1111111111111111111111111111111111111111";

describe("E2EE settings (WP-1.7)", () => {
  it("round-trips with the same wallet signature", async () => {
    const key = await deriveSettingsKey(SIG_A, ADDR);
    const sealed = await encryptSettings('{"theme":"dark"}', key);
    expect(sealed.ciphertext).not.toContain("dark");
    const out = await decryptSettings(sealed, key);
    expect(out).toBe('{"theme":"dark"}');
  });

  it("cannot be decrypted with a different signature", async () => {
    const keyA = await deriveSettingsKey(SIG_A, ADDR);
    const keyB = await deriveSettingsKey(SIG_B, ADDR);
    const sealed = await encryptSettings("secret", keyA);
    await expect(decryptSettings(sealed, keyB)).rejects.toBeTruthy();
  });

  it("uses a fresh IV per encryption", async () => {
    const key = await deriveSettingsKey(SIG_A, ADDR);
    const a = await encryptSettings("same", key);
    const b = await encryptSettings("same", key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

// SR-2: the key is bound to the stable OIDC `subject` (verbatim, case-sensitive),
// so a wallet-less identity still derives a stable cross-device key and no two
// subjects can read each other's settings.
describe("E2EE settings — subject binding (SR-2)", () => {
  it("derives a different key per subject", async () => {
    const a = await deriveSettingsKey(SIG_A, "google-oauth2|abc");
    const b = await deriveSettingsKey(SIG_A, "google-oauth2|xyz");
    const sealed = await encryptSettings("secret", a);
    await expect(decryptSettings(sealed, b)).rejects.toBeTruthy();
  });

  it("treats the subject verbatim (case matters)", async () => {
    const lower = await deriveSettingsKey(SIG_A, "user|abc");
    const upper = await deriveSettingsKey(SIG_A, "user|ABC");
    const sealed = await encryptSettings("x", lower);
    await expect(decryptSettings(sealed, upper)).rejects.toBeTruthy();
  });
});

// SR-3: the blind index lets the server match on-chain activity to a watched
// address without learning the address or the list — a keyed HMAC, client-derived.
describe("watchlist blind index (SR-3)", () => {
  it("is deterministic per (key, address) and address-case-insensitive", async () => {
    const k = await deriveBlindIndexKey(SIG_A, "user|1");
    const a1 = await blindIndex(k, "0xAbC0000000000000000000000000000000000001");
    const a2 = await blindIndex(k, "0xabc0000000000000000000000000000000000001");
    expect(a1).toBe(a2);
  });

  it("differs across addresses and across subjects", async () => {
    const k1 = await deriveBlindIndexKey(SIG_A, "user|1");
    const k2 = await deriveBlindIndexKey(SIG_A, "user|2");
    const addr = "0x0000000000000000000000000000000000000009";
    expect(await blindIndex(k1, addr)).not.toBe(await blindIndex(k2, addr));
    expect(await blindIndex(k1, "0x...1".padEnd(42, "0"))).not.toBe(
      await blindIndex(k1, "0x...2".padEnd(42, "0")),
    );
  });
});
