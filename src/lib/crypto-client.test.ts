import { describe, it, expect } from "vitest";
import {
  deriveSettingsKey,
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
