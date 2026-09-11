import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest. This is what makes the app installable on
// Android and desktop Chrome; iOS reads the apple-* tags in layout.tsx instead.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wallet Tracker",
    short_name: "Wallet",
    description: "Read-only crypto holdings, mining income, and purchase log.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
