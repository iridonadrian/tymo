import type { MetadataRoute } from "next";

/** Installable app (desktop + mobile). The share target lets phones "Share → Tymo". */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tymo — Save it. Close it. Find it later.",
    short_name: "Tymo",
    description: "Open-source digital memory for the internet.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
    shortcuts: [
      { name: "Inbox", url: "/inbox" },
      { name: "New save", url: "/share" },
    ],
  };
}
