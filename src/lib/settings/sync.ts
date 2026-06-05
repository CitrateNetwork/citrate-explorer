"use client";

/**
 * SR-2 — E2EE settings sync. Appearance/preferences are encrypted in the browser
 * with a key derived from the auth-seam key material (embedded/external wallet
 * signature, or a future WebAuthn PRF) bound to the stable OIDC `subject`, and
 * stored as opaque ciphertext at `/api/settings` (the server can never read them).
 * localStorage remains the no-flash device cache; this layer makes settings sync
 * across devices, zero-knowledge — the exact guarantee the Privacy panel claims.
 *
 * Browser-only (Web Crypto). The key lives in memory for the tab session only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/client";
import {
  deriveSettingsKey,
  deriveBlindIndexKey,
  encryptSettings,
  decryptSettings,
} from "@/lib/crypto-client";

export interface SettingsKeyState {
  /** AES-GCM key for E2EE settings + watchlist payloads. */
  key: CryptoKey | null;
  /** HMAC key for watchlist blind indexes (SR-3). */
  blindKey: CryptoKey | null;
  locked: boolean;
  unlocking: boolean;
  error: string | null;
  unlock: () => Promise<void>;
  lock: () => void;
}

/**
 * Resolve (sign-once) and hold the in-memory E2EE keys for this tab session: the
 * AES settings/watchlist key and the HMAC blind-index key, both bound to the
 * stable subject and derived from one signature.
 */
export function useSettingsKey(): SettingsKeyState {
  const auth = useAuth();
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [blindKey, setBlindKey] = useState<CryptoKey | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = useCallback(async () => {
    if (!auth.sub) {
      setError("Sign in to enable encrypted sync.");
      return;
    }
    setUnlocking(true);
    setError(null);
    try {
      const material = await auth.getKeyMaterial();
      if (!material) {
        // Today's signer is the wallet (EOA/SIWE). Passkey-PRF unlock arrives with
        // the EW-S1 sign-in overhaul; the seam already accepts it (getKeyMaterial).
        setError("Connect a wallet to unlock encrypted settings.");
        return;
      }
      setKey(await deriveSettingsKey(material, auth.sub));
      setBlindKey(await deriveBlindIndexKey(material, auth.sub));
    } catch (e) {
      setError((e as Error).message || "Could not unlock encrypted settings.");
    } finally {
      setUnlocking(false);
    }
  }, [auth]);

  const lock = useCallback(() => {
    setKey(null);
    setBlindKey(null);
  }, []);
  return { key, blindKey, locked: !key, unlocking, error, unlock, lock };
}

export type SyncStatus = "idle" | "loading" | "synced" | "saving" | "error";

/**
 * Two-way E2EE sync of a plain settings object. On unlock it pulls + decrypts the
 * server copy and applies it via `applyRemote`; subsequent local changes are
 * debounced, encrypted, and pushed. `current` is serialized for change detection,
 * so callers may pass a fresh object each render.
 */
export function useSyncedSettings<T extends Record<string, unknown>>(params: {
  key: CryptoKey | null;
  current: T;
  applyRemote: (incoming: Partial<T>) => void;
}): { status: SyncStatus } {
  const { key, current, applyRemote } = params;
  const auth = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const loadedRef = useRef(false);
  // Suppress the save that the post-load applyRemote would otherwise trigger.
  const suppressNextSaveRef = useRef(false);
  const serialized = JSON.stringify(current);

  const authHeader = useCallback(async (): Promise<Record<string, string>> => {
    const t = await auth.getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }, [auth]);

  // Pull + decrypt once, when the key becomes available.
  useEffect(() => {
    if (!key || loadedRef.current) return;
    loadedRef.current = true;
    let cancelled = false;
    void (async () => {
      setStatus("loading");
      try {
        const res = await fetch("/api/settings", { headers: await authHeader() });
        const j = (await res.json()) as { settings?: { ciphertext: string; iv: string } | null };
        if (!cancelled && res.ok && j.settings?.ciphertext) {
          const plain = await decryptSettings(
            { ciphertext: j.settings.ciphertext, iv: j.settings.iv },
            key,
          );
          suppressNextSaveRef.current = true;
          applyRemote(JSON.parse(plain) as Partial<T>);
        }
        if (!cancelled) setStatus("synced");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, authHeader, applyRemote]);

  // Push (debounced) on local change, after the initial load.
  useEffect(() => {
    if (!key || !loadedRef.current) return;
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        setStatus("saving");
        try {
          const sealed = await encryptSettings(serialized, key);
          const res = await fetch("/api/settings", {
            method: "PUT",
            headers: { "content-type": "application/json", ...(await authHeader()) },
            body: JSON.stringify(sealed),
          });
          setStatus(res.ok ? "synced" : "error");
        } catch {
          setStatus("error");
        }
      })();
    }, 800);
    return () => clearTimeout(handle);
  }, [serialized, key, authHeader]);

  return { status };
}
