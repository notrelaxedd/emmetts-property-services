/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    // The old booking page is gone; keep any shared links working.
    return [{ source: "/book", destination: "/contact", permanent: true }];
  },
};

export default nextConfig;
