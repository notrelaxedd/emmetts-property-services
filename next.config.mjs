/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The quote form posts up to 4 compressed photos through a server action (Vercel caps requests at ~4.5 MB).
    serverActions: { bodySizeLimit: "5mb" },
  },
  async redirects() {
    // The old booking page is gone; keep any shared links working.
    return [{ source: "/book", destination: "/contact", permanent: true }];
  },
};

export default nextConfig;
