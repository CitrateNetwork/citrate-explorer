// @ts-nocheck
/* eslint-disable */
"use client";

/**
 * ScanProvider / useScan — replaces the prototype's `window.Scan` global and the
 * App component's shared state (route, tweaks, agent drawer). The API matches the
 * CONVERSION_GUIDE contract that every ported screen depends on.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { SH } from "./harness";

export const TWEAK_DEFAULTS = {
  theme: "light",
  accent: "#8ecc09",
  hashEmphasis: "muted",
  verbosity: "full",
  agentDefaultOpen: false,
  reducedMotion: false,
  showIndexer: false,
  rpcReconnecting: false,
  summaryWarming: false,
};

export function parseRoute() {
  let h = (typeof location !== "undefined" ? location.hash : "#/").replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "home" };
  const [a, b] = parts;
  if (a === "tx") return { name: "tx", id: b };
  if (a === "block") return { name: "block", id: b };
  if (a === "address") return { name: "address", id: b };
  if (a === "contract") return { name: "contract", id: b };
  if (a === "token") return { name: "token", id: b };
  if (a === "dag") return { name: "dag" };
  if (a === "apis") return { name: "dev" };
  if (a === "account" || a === "settings") return { name: "settings" };
  return { name: "home" };
}

const ScanContext = createContext(null);

export function useScan() {
  return useContext(ScanContext);
}

export function ScanProvider({ children }) {
  const [tweaks, setTweaks] = useState(TWEAK_DEFAULTS);
  const [route, setRoute] = useState(parseRoute);
  const [agentOpen, setAgentOpen] = useState(TWEAK_DEFAULTS.agentDefaultOpen);
  const agentRef = useRef({});

  const setTweak = useCallback((k, v) => setTweaks((t) => ({ ...t, [k]: v })), []);

  // Apply theme + accent + hash emphasis on <html> so body resolves vars.
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", tweaks.theme);
    el.style.setProperty("--accent", tweaks.accent);
    el.style.setProperty(
      "--hash-color",
      tweaks.hashEmphasis === "muted" ? "var(--text-3)" : "var(--text-2)",
    );
  }, [tweaks.theme, tweaks.accent, tweaks.hashEmphasis]);

  useEffect(() => setAgentOpen(tweaks.agentDefaultOpen), [tweaks.agentDefaultOpen]);

  // Hash routing.
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const nav = useCallback((r) => {
    location.hash = "#/" + r;
  }, []);

  const ask = useCallback((seed, label) => {
    setAgentOpen(true);
    agentRef.current && agentRef.current.ask && agentRef.current.ask(seed, label);
  }, []);

  const setCtx = useCallback((label) => {
    agentRef.current && agentRef.current.setContext && agentRef.current.setContext(label);
  }, []);

  // Omni-search resolver (shared by header, home, palette).
  const search = useCallback((qstr) => {
    const c = SH.classify(qstr);
    if (c.kind === "search" || c.kind === "empty") {
      setAgentOpen(true);
      agentRef.current && agentRef.current.ask && agentRef.current.ask(qstr);
      return;
    }
    const r =
      c.kind === "tx" ? `tx/${c.value}` :
      c.kind === "block" ? `block/${c.value}` :
      c.kind === "token" ? `token/${c.value}` :
      c.kind === "contract" ? `contract/${c.value}` :
      `address/${c.value}`;
    nav(r);
  }, [nav]);

  const value = {
    nav, search, ask, setCtx, setTweak, tweaks,
    route, agentOpen, setAgentOpen, agentRef,
  };

  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}
