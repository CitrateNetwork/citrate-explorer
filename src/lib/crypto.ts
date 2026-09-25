/**
 * Server-side cryptography for CitrateScan's HYBRID secret model
 * (see DESIGN_HARNESS_AND_SETTINGS.md §B and .agentile/CONFIG.md).
 *
 * Three data classes, three postures:
 *  1. User settings / logins → E2EE (handled client-side; see crypto-client.ts).
 *     The server only ever stores opaque ciphertext it cannot read.
 *  2. OUR issued API keys → hashed (scrypt, salted with a server pepper), shown once, never
 *     recoverable. `hashApiKey` here; we compare hashes on every API request.
 *  3. Third-party provider keys the agent must USE server-side → AES-256-GCM at
 *     rest with a per-user key derived from `APP_MASTER_KEY` + wallet. `sealForUser`
 *     / `openForUser` here — the server can decrypt to run tools on the user's behalf.
 *
 * Data source (Rule 11): ciphertext/iv/authTag columns in Neon; keys from the
 * `APP_MASTER_KEY` / `API_KEY_PEPPER` server env vars.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  scrypt,
} from "node:crypto";

const IV_LENGTH = 12; // AES-GCM nonce (96 bits)
const KEY_LENGTH = 32; // AES-256
const AUTH_TAG_LENGTH = 16; // GCM tag (128 bits)

export interface SealedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

function requireKey(envName: "APP_MASTER_KEY"): Buffer {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(
      `${envName} is not set — required to encrypt secrets at rest. ` +
        "Generate with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `${envName} must decode to ${KEY_LENGTH} bytes (got ${key.length}).`,
    );
  }
  return key;
}

/**
 * Per-user 256-bit data key via HKDF-SHA-256, bound to the owner.
 *
 * PBA-L3c-034: v2 binds the owner VERBATIM. The owner is the OIDC `sub`, which
 * SR-0 defines as opaque and case-sensitive; v1 lower-cased it, so "Alice" and
 * "alice" derived the same key. New seals use v2; {@link openForUser} still
 * opens v1 payloads (the GCM tag tells them apart), so no data migration is
 * needed.
 */
function deriveUserKey(owner: string, version: 1 | 2 = 2): Buffer {
  const bound = version === 1 ? owner.toLowerCase() : owner;
  const derived = hkdfSync(
    "sha256",
    requireKey("APP_MASTER_KEY"),
    Buffer.from(`citrate-explorer:${bound}`), // salt
    Buffer.from(version === 1 ? "citrate-explorer-secret-v1" : "citrate-explorer-secret-v2"), // info / domain separation
    KEY_LENGTH,
  );
  return Buffer.from(derived);
}

/** Seal a third-party secret for `userAddress` (recoverable server-side). */
export function sealForUser(
  plaintext: string,
  userAddress: string,
): SealedPayload {
  const key = deriveUserKey(userAddress);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function openWithKey(payload: SealedPayload, key: Buffer): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64"),
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Open a payload sealed by {@link sealForUser}; throws on tamper/wrong user.
 * Tries the v2 (verbatim-owner) key, then the legacy v1 (lower-cased) key.
 */
export function openForUser(
  payload: SealedPayload,
  userAddress: string,
): string {
  try {
    return openWithKey(payload, deriveUserKey(userAddress, 2));
  } catch {
    return openWithKey(payload, deriveUserKey(userAddress, 1));
  }
}

// --- Our issued API keys: hash-only, never recoverable ----------------------

/** Generates a fresh API key (shown to the user exactly once): `cscan_` + 24 random bytes, base64url. */
export function generateApiKey(): string {
  return `cscan_${randomBytes(24).toString("base64url")}`;
}

/**
 * The exact shape generateApiKey emits. Callers MUST check a presented key against this before
 * hashing it: the key hash is a deliberately expensive KDF, and it must never run on arbitrary input.
 */
export const API_KEY_RE = /^cscan_[A-Za-z0-9_-]{32}$/;

/**
 * EX-B-010 (RM-Q remediation, 2026-09-07): the server pepper is REQUIRED, not
 * optional. Previously `process.env.API_KEY_PEPPER ?? ""` silently fell back to
 * an empty pepper — producing a bare `sha256(":" + rawKey)` that a database read
 * could attack offline without the server secret, and silently contradicting the
 * spec ("salted SHA-256 + server pepper", stated unconditionally). It now fails
 * CLOSED the same way `requireKey("APP_MASTER_KEY")` does: throw at first use
 * when the pepper is unset/empty, so a mis-provisioned deploy is caught loudly
 * rather than degrading the hash. The hash construction itself is unchanged, so
 * hashes stored under a configured pepper keep verifying.
 */
function requirePepper(): string {
  const pepper = process.env.API_KEY_PEPPER;
  if (!pepper || pepper.length === 0) {
    throw new Error(
      "API_KEY_PEPPER is not set — required to hash issued API keys at rest. " +
        "Generate with: openssl rand -base64 32",
    );
  }
  return pepper;
}

/**
 * Stored form of an issued API key: scrypt(key, salt = server pepper), 32 bytes, hex.
 *
 * A memory-hard KDF keyed by the required server pepper: a database read is not attackable offline
 * without the pepper and is costly even with it. Keys are 192-bit random tokens, so a modest cost
 * (N=2^12, 4 MiB) is ample; the KDF is defence in depth, not the source of key strength. It runs asynchronously (libuv threadpool, not the event loop), and only on keys
 * that match API_KEY_RE after the caller's per-IP key-check budget (lib/api/keys.ts). Hashes stored
 * by earlier releases cannot be converted (raw keys are never stored); migration 0004 retires them.
 */
export const API_KEY_SCRYPT = { N: 4096, r: 8, p: 1, keylen: 32 } as const;

export function hashApiKey(rawKey: string): Promise<string> {
  const pepper = requirePepper();
  const { N, r, p, keylen } = API_KEY_SCRYPT;
  return new Promise((resolve, reject) => {
    scrypt(rawKey, pepper, keylen, { N, r, p }, (err, dk) => (err ? reject(err) : resolve(dk.toString("hex"))));
  });
}
