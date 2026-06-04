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
              width: 56,
              height: 56,
              borderRadius: 15,
              background: "#8ecc09",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="30" height="30" viewBox="0 0 100 100">
              <polygon points="50,16 86,84 14,84" fill="#0b1411" />
            </svg>
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>CitrateScan</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.04, letterSpacing: -1.5, maxWidth: 1000 }}>
            The AI-native explorer for the Citrate Network
          </div>
          <div style={{ fontSize: 29, color: "#a9b8a4", maxWidth: 980, lineHeight: 1.3 }}>
            A GHOSTDAG BlockDAG for AI — models, LoRAs, federated learning, x402 payments,
            and DePIN compute. Ask the on-chain agent in plain English.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {["Chain 40204 · SALT", "AI agents & inference", "x402 · DePIN · FL", "EVM-compatible"].map((t) => (
            <div
              key={t}
              style={{
                display: "flex",
                fontSize: 23,
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
