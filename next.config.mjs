/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ensure server route uses Node (not Edge) for nicer rate limits and fetch behavior
  experimental: { serverMinification: true }
};
export default nextConfig;
