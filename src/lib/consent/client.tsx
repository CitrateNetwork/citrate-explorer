"use client";

/**
 * Cookie / storage consent (GDPR + CCPA). A single seam the whole app uses:
 *  - `useConsent()` exposes the current choice + actions.
 *  - `<ConsentProvider>` (mounted once in the root layout) holds the state and
 *    resolves the visitor's regime from `/api/region` (Vercel geo).
 *  - `<ConsentBanner>` is the first-visit gate.
 *
 * Regimes:
 *  - `gdpr`  (EU/EEA/UK): opt-IN — non-essential storage is off until accepted.
 *  - `ccpa`  (US/California): opt-OUT — a "Do Not Sell/Share" choice.
 *  - `standard` (rest of world): opt-in banner, lighter copy.
 * Default is `gdpr` (strictest) when the region is unknown — fail-closed.
 *
 * Non-essential categories (analytics, preferences) MUST check
 * `useConsent().allowed("analytics")` before loading. Essential storage (login
 * session, theme, this consent record) always works.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export type Regime = "gdpr" | "ccpa" | "standard";
export interface Consent {
  essential: true;
  analytics: boolean;
  preferences: boolean;
  ts: number;
  /** Bumps when the policy changes → re-prompt. */
  version: number;
}

export const CONSENT_VERSION = 1;
const KEY = "citrate.consent";

interface ConsentCtx {
  consent: Consent | null;
  regime: Regime;
  needed: boolean;
  allowed: (cat: "analytics" | "preferences") => boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  save: (partial: { analytics?: boolean; preferences?: boolean }) => void;
  reopen: () => void;
  managing: boolean;
  setManaging: (v: boolean) => void;
}

const Ctx = createContext<ConsentCtx | null>(null);

export function useConsent(): ConsentCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConsent must be used within <ConsentProvider>");
  return c;
}

function read(): Consent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c.version !== CONSENT_VERSION) return null; // policy bumped → re-prompt
    return c;
  } catch {
    return null;
  }
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  // IMPORTANT: do NOT read localStorage during render — that value differs
  // between server (null) and client, which is a hydration mismatch that can
  // leave the banner visible-but-dead (handlers unattached). Instead start null
  // on both, read in an effect, and only treat consent as "needed" once hydrated.
  const [consent, setConsent] = useState<Consent | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [regime, setRegime] = useState<Regime>("gdpr");
  const [managing, setManaging] = useState(false);

  // Client-only: load the saved choice after mount (no SSR/client divergence).
  // Deferred to a microtask so we're not calling setState synchronously inside
  // the effect (avoids the cascading-render lint + an extra commit).
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setConsent(read());
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the visitor's regime (best-effort; defaults to the strictest).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/region")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j && j.regime) setRegime(j.regime as Regime);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((c: Consent) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      /* ignore */
    }
    setConsent(c);
    setManaging(false);
  }, []);

  const acceptAll = useCallback(
    () => persist({ essential: true, analytics: true, preferences: true, ts: Date.now(), version: CONSENT_VERSION }),
    [persist],
  );
  const rejectAll = useCallback(
    () => persist({ essential: true, analytics: false, preferences: false, ts: Date.now(), version: CONSENT_VERSION }),
    [persist],
  );
  const save = useCallback(
    (p: { analytics?: boolean; preferences?: boolean }) =>
      persist({
        essential: true,
        analytics: Boolean(p.analytics),
        preferences: Boolean(p.preferences),
        ts: Date.now(),
        version: CONSENT_VERSION,
      }),
    [persist],
  );
  const reopen = useCallback(() => {
    setManaging(true);
    setConsent(null);
  }, []);

  const allowed = useCallback(
    (cat: "analytics" | "preferences") => Boolean(consent && consent[cat]),
    [consent],
  );

  const value: ConsentCtx = {
    consent,
    regime,
    // Only prompt after hydration so the banner is a pure client-side island
    // (no server-rendered banner → no hydration mismatch → handlers always attach).
    needed: hydrated && consent === null,
    allowed,
    acceptAll,
    rejectAll,
    save,
    reopen,
    managing,
    setManaging,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
