import type { NextConfig } from "next";

// Security headers for every route. Deliberately no Content-Security-Policy or
// Strict-Transport-Security: the app inlines its theme bootstrap script and the
// test deployment terminates TLS with a self-signed certificate.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Keep isolated HTTP/build verification from taking the active dev server's lock.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  output: "standalone",
  typedRoutes: true,
  poweredByHeader: false,
  // The README documents localhost:3000, but 127.0.0.1 is a different dev origin
  // and would otherwise stay on the boot screen (Next 16 dev origin check).
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // Keep datasets, local artifacts, secrets and tooling out of the standalone
  // image. data/sample/ is intentionally NOT excluded: demo mode reads those
  // CSVs from the app working directory at runtime.
  outputFileTracingExcludes: {
    "/*": [
      ".env",
      ".env.*",
      "records/**/*",
      "**/*.test.ts",
      "**/*.test.tsx",
      "oulad.zip",
      "oulad_raw/**",
      "output/**",
      "docs/**",
      "scripts/**",
      "*.md",
      ".interface-design/**",
      "tsconfig.tsbuildinfo",
      "data/fixtures/**",
    ],
  },
};

export default nextConfig;
