import type { NextConfig } from "next";

const API = process.env.API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // the single-container Space image serves the standalone build with plain node
  output: process.env.STANDALONE ? "standalone" : undefined,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/files/:path*", destination: `${API}/files/:path*` },
    ];
  },
  devIndicators: false,
  // live SAM 3.1 + Muse Spark inspections and the root-cause stream can outlast the 30 s proxy default
  experimental: { proxyTimeout: 180_000 },
  allowedDevOrigins: ["*.local", "192.168.*.*", "10.*.*.*"],
};

export default nextConfig;
