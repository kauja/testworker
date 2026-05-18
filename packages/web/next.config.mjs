/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@testworker/shared'],
  output: 'standalone',
};

export default nextConfig;
