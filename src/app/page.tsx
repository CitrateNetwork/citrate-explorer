"use client";

import dynamic from "next/dynamic";

// CitrateScan is a pure client SPA (matching the design prototype): render it
// client-only to avoid SSR/hydration mismatch from its time/random-seeded sample
// data and browser-only canvas/DAG drawing.
const CitrateScanApp = dynamic(
  () => import("@/scan/app").then((m) => m.CitrateScanApp),
  { ssr: false },
);

export default function Page() {
  return <CitrateScanApp />;
}
