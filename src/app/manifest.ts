import type { MetadataRoute } from "next";

/**
 * Web app manifest (PWA + Lighthouse). Brand colors: citrate green on deep
 * evergreen. Icons are the triangle mark from the brand set.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CitrateScan — AI-native block explorer",
    short_name: "CitrateScan",
    description:
      "The AI-native block explorer for the Citrate Network — a GHOSTDAG BlockDAG for AI.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1411",
    theme_color: "#0f2a1a",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "256x256", type: "image/png" },
    ],
    categories: ["developer", "utilities", "finance"],
  };
}
