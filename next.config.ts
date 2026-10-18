import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep isolated HTTP/build verification from taking the active dev server's lock.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  output: "standalone",
  typedRoutes: true,
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  outputFileTracingExcludes: {
    "/*": [".env", ".env.*", "records/**/*", "**/*.test.ts", "**/*.test.tsx"],
  },
};

export default nextConfig;
