-- PBA R2 (CodeQL js/insufficient-password-hash): issued API keys are now stored as
-- scrypt(key, salt = API_KEY_PEPPER) instead of SHA-256(pepper ":" key). Hashes cannot be
-- converted without the raw keys (never stored), so every pre-R2 key is revoked here.
-- Users re-mint from Settings -> API keys; revoked keys stop counting toward the per-user cap.
UPDATE "api_keys" SET "revoked" = true WHERE "revoked" = false;
