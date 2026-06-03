/**
 * Resolves the visitor's privacy regime from the edge geo header (Vercel sets
 * `x-vercel-ip-country`). Used by the consent banner to pick GDPR (opt-in),
 * CCPA (opt-out), or standard. Defaults to the strictest (gdpr) when unknown —
 * fail-closed. No PII stored; the country code is read, used, and discarded.
 */
const EU_EEA_UK = new Set([
  // EU
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEA
  "IS", "LI", "NO",
  // UK
  "GB",
]);

export function GET(req: Request) {
  const country = (
    req.headers.get("x-vercel-ip-country") ||
    req.headers.get("cf-ipcountry") ||
    ""
  ).toUpperCase();

  let regime: "gdpr" | "ccpa" | "standard" = "gdpr";
  if (country) {
    if (EU_EEA_UK.has(country)) regime = "gdpr";
    else if (country === "US") regime = "ccpa";
    else regime = "standard";
  }
  return Response.json({ country: country || null, regime });
}
