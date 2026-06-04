import { ImageResponse } from "next/og";

/**
 * Default social-share card (P-8 WP-8.2). Rendered at build/edge via next/og —
 * no external font fetch, so it builds offline and never blocks. Per-entity OG
 * images (block/tx/address) land with the App Router path migration.
 */
export const alt = "CitrateScan — AI-native block explorer for the Citrate Network";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Og() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #0b1411 0%, #12211a 55%, #1a2b10 100%)",
          color: "#f4f7f2",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 14,
              background: "#b7f23a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0b1411",
              fontSize: 34,
              fontWeight: 800,
            }}
          >
            C
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>CitrateScan</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 980 }}>
            The AI-native block explorer for Citrate
          </div>
          <div style={{ fontSize: 30, color: "#a9b8a4", maxWidth: 900 }}>
            GHOSTDAG BlockDAG · plain-English answers · contract verification · programmable API
          </div>
        </div>

        <div style={{ display: "flex", gap: 14 }}>
          {["Chain 40204", "Native SALT", "Ask the agent"].map((t) => (
            <div
              key={t}
              style={{
                display: "flex",
                fontSize: 24,
                color: "#cfe0c4",
                border: "1px solid #2e4a33",
                borderRadius: 999,
                padding: "8px 22px",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
