/**
 * Client-side E2EE for user settings/logins (HYBRID model, class 1).
 *
 * The key is derived in the BROWSER from a wallet signature over a fixed message,
 * via HKDF → AES-256-GCM. The server only ever receives/stores opaque ciphertext
 * it cannot decrypt (it never sees the signature or the derived key). This is the
 * "server can't read your settings" guarantee in the transparency panel.
 *
 * Uses the Web Crypto API (`globalThis.crypto.subtle`), so this module is
 * browser-only — never import it into a server route.
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/** The fixed message the wallet signs to bootstrap the settings key. */
export const E2EE_KEY_MESSAGE =
  "CitrateScan settings encryption key v1 — sign to unlock your private settings. " +
  "This signature never leaves your browser.";

/** Derives a non-extractable AES-GCM key from a wallet signature hex string. */
export async function deriveSettingsKey(
  signatureHex: string,
  userAddress: string,
): Promise<CryptoKey> {
  const sigBytes = hexToBytes(signatureHex);
  const ikm = await crypto.subtle.importKey("raw", sigBytes, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: ENC.encode(`citrate-explorer-settings:${userAddress.toLowerCase()}`),
      info: ENC.encode("citrate-explorer-settings-v1"),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface ClientSealed {
  ciphertext: string; // base64
  iv: string; // base64
}

/** Encrypts a plaintext string with the derived settings key. */
export async function encryptSettings(
  plaintext: string,
  key: CryptoKey,
): Promise<ClientSealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    ENC.encode(plaintext),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv) };
}

/** Decrypts a {@link ClientSealed} payload with the derived settings key. */
export async function decryptSettings(
  payload: ClientSealed,
  key: CryptoKey,
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext),
  );
  return DEC.decode(pt);
}

// --- small encoding helpers (no Node Buffer in the browser) -----------------

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
