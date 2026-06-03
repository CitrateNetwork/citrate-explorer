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
  const [consent, setConsent] = useState<Consent | null>(() => read());
  const [regime, setRegime] = useState<Regime>("gdpr");
  const [managing, setManaging] = useState(false);

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
    needed: consent === null,
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
