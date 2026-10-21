import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // fileURLToPath, not .pathname, so Windows gets a real drive path ("D:\\a", not "/D:/a").
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: ["@tymo/core"],
  serverExternalPackages: ["@libsql/client", "libsql"],
  poweredByHeader: false,
  // Tymo never uses next/image (remote images go through the /img proxy), so the built-in
  // optimizer (/_next/image, sharp/libvips) is switched off: it answers 404 and never
  // decodes anything. That route also bypasses the password gate in src/proxy.ts.
  images: { unoptimized: true },
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "26mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // Ignored by browsers over plain HTTP (localhost); pins HTTPS once served over it.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};

export default nextConfig;
