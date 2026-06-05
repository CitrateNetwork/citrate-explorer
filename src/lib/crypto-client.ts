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

/**
 * Derives a non-extractable AES-GCM key from the auth-seam key material (a wallet
 * signature hex, or a WebAuthn-PRF secret) bound to the stable OIDC `owner`
 * (subject). The owner is an opaque, case-sensitive id — it is used VERBATIM in
 * the HKDF salt (SR-0/SR-2), so the same identity derives the same key across
 * devices regardless of whether it has a wallet.
 */
export async function deriveSettingsKey(
  keyMaterialHex: string,
  owner: string,
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", hexToBytes(keyMaterialHex), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: ENC.encode(`citrate-explorer-settings:${owner}`),
      info: ENC.encode("citrate-explorer-settings-v1"),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Derives a per-user **blind-index key** (SR-3) from the same key material, bound
 * to the owner with a distinct HKDF `info`. Used to compute keyed HMACs of watched
 * addresses so the server can match on-chain activity WITHOUT learning the address
 * or the user's list. Distinct from the settings key (different `info`).
 */
export async function deriveBlindIndexKey(
  keyMaterialHex: string,
  owner: string,
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", hexToBytes(keyMaterialHex), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: ENC.encode(`citrate-explorer-watchlist-index:${owner}`),
      info: ENC.encode("citrate-explorer-watchlist-index-v1"),
    },
    ikm,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

/** Compute the deterministic blind index (hex HMAC) for a watched address. */
export async function blindIndex(key: CryptoKey, address: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", key, ENC.encode(address.toLowerCase()));
  return bytesToBase64(new Uint8Array(mac));
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
