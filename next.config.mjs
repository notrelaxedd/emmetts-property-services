/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The quote form posts up to 4 compressed photos through a server action (Vercel caps requests at ~4.5 MB).
    serverActions: { bodySizeLimit: "5mb" },
    // The flyer route reads the template and font from disk (lib/flyers/render.ts); ship them with it.
    outputFileTracingIncludes: {
      "/admin/employees/flyers/[id]/flyer": ["./assets/flyer/**", "./assets/fonts/Anton-Regular.ttf"],
    },
  },
  async redirects() {
    // The old booking page is gone; keep any shared links working.
    return [{ source: "/book", destination: "/contact", permanent: true }];
  },
};

export default nextConfig;
