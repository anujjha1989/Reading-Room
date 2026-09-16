import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/catalog.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=60, stale-while-revalidate=300" }],
      },
    ];
  },
};

export default nextConfig;
