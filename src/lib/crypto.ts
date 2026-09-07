/**
 * Server-side cryptography for CitrateScan's HYBRID secret model
 * (see DESIGN_HARNESS_AND_SETTINGS.md §B and .agentile/CONFIG.md).
 *
 * Three data classes, three postures:
 *  1. User settings / logins → E2EE (handled client-side; see crypto-client.ts).
 *     The server only ever stores opaque ciphertext it cannot read.
 *  2. OUR issued API keys → hashed (salted SHA-256 + pepper), shown once, never
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
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
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

/** Per-user 256-bit data key via HKDF-SHA-256, bound to the lower-cased wallet. */
function deriveUserKey(userAddress: string): Buffer {
  const normalized = userAddress.toLowerCase();
  const derived = hkdfSync(
    "sha256",
    requireKey("APP_MASTER_KEY"),
    Buffer.from(`citrate-explorer:${normalized}`), // salt
    Buffer.from("citrate-explorer-secret-v1"), // info / domain separation
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

/** Open a payload sealed by {@link sealForUser}; throws on tamper/wrong user. */
export function openForUser(
  payload: SealedPayload,
  userAddress: string,
): string {
  const key = deriveUserKey(userAddress);
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

// --- Our issued API keys: hash-only, never recoverable ----------------------

/** Generates a fresh API key (shown to the user exactly once). */
export function generateApiKey(): string {
  // 32 random bytes → url-safe base64, prefixed so it's recognizable.
  return `cscan_${randomBytes(24).toString("base64url")}`;
}

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

/** Salted SHA-256 (+ required server pepper) hash of an issued API key. */
export function hashApiKey(rawKey: string): string {
  const pepper = requirePepper();
  return createHash("sha256").update(`${pepper}:${rawKey}`).digest("hex");
}

/** Constant-time comparison of a presented key against a stored hash. */
export function verifyApiKey(rawKey: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(rawKey), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
