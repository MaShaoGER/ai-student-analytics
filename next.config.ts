import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  typedRoutes: true,
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  outputFileTracingExcludes: {
    "/*": [".env", ".env.*", "records/**/*", "**/*.test.ts", "**/*.test.tsx"],
  },
};

export default nextConfig;
