import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Emmett’s Crew",
    short_name: "Crew",
    description: "Jobs, hours and pay for the Emmett’s Property Services crew.",
    start_url: "/crew",
    scope: "/crew",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7F7F6",
    theme_color: "#F7F7F6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
