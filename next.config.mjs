/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // O legado em public/legacy/app.js não é lintado pelo Next (é JS puro servido como estático).
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
