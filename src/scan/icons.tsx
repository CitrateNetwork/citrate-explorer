// @ts-nocheck
/* eslint-disable */
"use client";

// scan-icons.jsx — single-stroke geometric icons (1.5px, currentColor) + Logo + Spark
export function Icon({ name, size = 18, strokeWidth = 1.5, style }) {
  const base = { width: size, height: size, strokeWidth, fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", display: "block", ...style };
  const P = {
    search:    <g><circle cx="11" cy="11" r="7" /><path d="M16 16 L21 21" /></g>,
    copy:      <g><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9 V6 a2 2 0 0 0-2-2 H6 a2 2 0 0 0-2 2 v7 a2 2 0 0 0 2 2 h3" /></g>,
    check:     <path d="M5 12.5 L10 17.5 L19 7" />,
    x:         <path d="M6 6 L18 18 M18 6 L6 18" />,
    info:      <g><circle cx="12" cy="12" r="9" /><path d="M12 11 V16 M12 8 h.01" /></g>,
    external:  <g><path d="M14 5 H19 V10" /><path d="M19 5 L11 13" /><path d="M19 14 V18 a1 1 0 0 1-1 1 H6 a1 1 0 0 1-1-1 V6 a1 1 0 0 1 1-1 H10" /></g>,
    arrowright:<path d="M5 12 H19 M13 6 L19 12 L13 18" />,
    arrowleft: <path d="M19 12 H5 M11 6 L5 12 L11 18" />,
    arrowup:   <path d="M12 19 V5 M6 11 L12 5 L18 11" />,
    arrowdown: <path d="M12 5 V19 M6 13 L12 19 L18 13" />,
    chevright: <path d="M9 6 L15 12 L9 18" />,
    chevdown:  <path d="M6 9 L12 15 L18 9" />,
    cube:      <g><path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z" /><path d="M4 7.5 L12 12 L20 7.5 M12 12 V21" /></g>,
    swap:      <path d="M5 8 H17 M14 5 L17 8 L14 11 M19 16 H7 M10 13 L7 16 L10 19" />,
    send:      <path d="M21 4 L3 11 L10 13 L12 20 L21 4 Z M10 13 L21 4" />,
    spark:     <path d="M12 3 C12.5 8 13.5 9.5 21 12 C13.5 14.5 12.5 16 12 21 C11.5 16 10.5 14.5 3 12 C10.5 9.5 11.5 8 12 3 Z" />,
    lattice:   <g><circle cx="6" cy="6" r="1.5" /><circle cx="18" cy="6" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="6" cy="18" r="1.5" /><circle cx="18" cy="18" r="1.5" /><path d="M7.3 7 L10.8 11 M16.7 7 L13.2 11 M10.8 13 L7.3 17 M13.2 13 L16.7 17" /></g>,
    shieldCheck:<g><path d="M12 3 L19 6 V11 c0 5-3 8-7 10 c-4-2-7-5-7-10 V6 Z" /><path d="M9 12 L11 14 L15 9.5" /></g>,
    bolt:      <path d="M13 3 L5 13 H11 L10 21 L19 10 H12 Z" />,
    key:       <g><circle cx="8" cy="8" r="4" /><path d="M10.8 10.8 L20 20 M17 17 L19 15 M14.5 14.5 L16.5 12.5" /></g>,
    code:      <path d="M9 8 L5 12 L9 16 M15 8 L19 12 L15 16" />,
    terminal:  <g><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9 L10 12 L7 15 M13 15 H17" /></g>,
    file:      <g><path d="M14 3 H6 a1 1 0 0 0-1 1 V20 a1 1 0 0 0 1 1 H18 a1 1 0 0 0 1-1 V8 Z" /><path d="M14 3 V8 H19" /></g>,
    download:  <path d="M12 4 V15 M7 10 L12 15 L17 10 M5 19 H19" />,
    settings:  <g><circle cx="12" cy="12" r="3" /><path d="M12 2 v3 M12 19 v3 M2 12 h3 M19 12 h3 M4.9 4.9 l2.1 2.1 M17 17 l2.1 2.1 M19.1 4.9 l-2.1 2.1 M7 17 l-2.1 2.1" /></g>,
    user:      <g><circle cx="12" cy="8" r="4" /><path d="M4 20 c0-4 3.5-6 8-6 s8 2 8 6" /></g>,
    shield:    <g><path d="M12 3 L19 6 V11 c0 5-3 8-7 10 c-4-2-7-5-7-10 V6 Z" /></g>,
    eye:       <g><path d="M2 12 C5 6 9 4 12 4 C15 4 19 6 22 12 C19 18 15 20 12 20 C9 20 5 18 2 12 Z" /><circle cx="12" cy="12" r="3" /></g>,
    database:  <g><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6 V18 c0 1.6 3.1 3 7 3 s7-1.4 7-3 V6 M5 12 c0 1.6 3.1 3 7 3 s7-1.4 7-3" /></g>,
    list:      <path d="M8 7 H20 M8 12 H20 M8 17 H20 M4 7 h.01 M4 12 h.01 M4 17 h.01" />,
    grid:      <g><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></g>,
    sun:       <g><circle cx="12" cy="12" r="4" /><path d="M12 2 V4 M12 20 V22 M4 12 H2 M22 12 H20 M5 5 L6.5 6.5 M17.5 17.5 L19 19 M19 5 L17.5 6.5 M6.5 17.5 L5 19" /></g>,
    moon:      <path d="M20 13 A8 8 0 1 1 11 4 a6 6 0 0 0 9 9 Z" />,
    sliders:   <path d="M4 8 H14 M18 8 H20 M4 16 H8 M12 16 H20 M16 6 V10 M10 14 V18" />,
    clock:     <g><circle cx="12" cy="12" r="9" /><path d="M12 7 V12 L15.5 14" /></g>,
    pause:     <g><rect x="7" y="6" width="3.5" height="12" rx="1" /><rect x="13.5" y="6" width="3.5" height="12" rx="1" /></g>,
    play:      <path d="M7 5 L19 12 L7 19 Z" />,
    refresh:   <path d="M4 12 a8 8 0 0 1 13.7-5.6 L20 8 M20 3.5 V8 H15.5" />,
    alert:     <g><path d="M12 3 L22 20 H2 Z" /><path d="M12 9 V14 M12 17 h.01" /></g>,
    link:      <g><path d="M10.5 13.5 a3 3 0 0 0 4.3.1 l2.4-2.4 a3 3 0 0 0-4.2-4.2 l-1.1 1.1" /><path d="M13.5 10.5 a3 3 0 0 0-4.3-.1 l-2.4 2.4 a3 3 0 0 0 4.2 4.2 l1.1-1.1" /></g>,
    logout:    <path d="M15 4 H19 a1 1 0 0 1 1 1 V19 a1 1 0 0 1-1 1 H15 M10 12 H21 M17 8 L21 12 L17 16" />,
    trash:     <g><path d="M4 7 H20 M9 7 V5 a1 1 0 0 1 1-1 h4 a1 1 0 0 1 1 1 v2" /><path d="M6 7 L7 20 a1 1 0 0 0 1 1 h8 a1 1 0 0 0 1-1 L18 7" /></g>,
    plus:      <path d="M12 5 V19 M5 12 H19" />,
    wallet:    <g><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10 H21 M16.5 14 h.01" /></g>,
    book:      <path d="M4 5 a2 2 0 0 1 2-2 h6 v16 H6 a2 2 0 0 0-2 2 Z M20 5 a2 2 0 0 0-2-2 h-6 v16 h6 a2 2 0 0 1 2 2 Z" />,
    layers:    <path d="M12 3 L21 8 L12 13 L3 8 Z M3 13 L12 18 L21 13 M3 17 L12 22 L21 17" />,
    coin:      <g><circle cx="12" cy="12" r="9" /><path d="M12 7 V17 M9.5 9 h4 a1.5 1.5 0 0 1 0 3 H10 a1.5 1.5 0 0 0 0 3 h4" /></g>,
    gauge:     <g><path d="M4 18 a8 8 0 1 1 16 0" /><path d="M12 14 L15.5 9.5" /><circle cx="12" cy="14" r="1.3" /></g>,
    branch:    <g><circle cx="7" cy="5" r="2.2" /><circle cx="7" cy="19" r="2.2" /><circle cx="17" cy="8" r="2.2" /><path d="M7 7.2 V16.8 M17 10.2 c0 4-4 3.6-7 5" /></g>,
    paste:     <g><rect x="6" y="4" width="12" height="16" rx="2" /><path d="M9 4 V3 h6 v1 M9 10 h6 M9 14 h4" /></g>,
    bell:      <path d="M6 16 V11 a6 6 0 0 1 12 0 v5 l2 3 H4 Z M10 21 a2 2 0 0 0 4 0" />,
  };
  return <svg viewBox="0 0 24 24" style={base} aria-hidden="true">{P[name] || null}</svg>;
}

// Marquee wordmark — white SVG (the header is always evergreen). Root-absolute
// path so it resolves under any hash route. Paired with the "SCAN" pill it forms
// the CitrateScan lockup.
export function Logo({ height = 24 }) {
  return <img src="/brand/citrate-wordmark-white.svg" alt="CitrateScan" style={{ height, display: "block" }} />;
}
