/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The quote form posts up to 4 compressed photos through a server action (Vercel caps requests at ~4.5 MB).
    serverActions: { bodySizeLimit: "5mb" },
    // The flyer routes read the template image and the code label's font from disk (lib/flyers/render.ts);
    // ship them with it. (The template's HTML source and its other fonts are only needed to re-render it.)
    outputFileTracingIncludes: {
      "/admin/employees/flyers/[id]/flyer": ["./assets/flyer/*.webp", "./assets/og/Montserrat-600-Subset.ttf"],
      "/admin/employees/flyers/generic": ["./assets/flyer/*.webp"],
    },
  },
  async redirects() {
    // The old booking page is gone; keep any shared links working.
    return [{ source: "/book", destination: "/contact", permanent: true }];
  },
};

export default nextConfig;
