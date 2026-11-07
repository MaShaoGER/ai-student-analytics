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

// Keep source material and private runtime state out of page traces.
// Runtime-owned paths in instrumentation must also be excluded at their
// filesystem access sites, since they are not ordinary page trace entries.
const outputFileTracingExcludes = [
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
  "data/sample/learning-process-v1/**",
  // Design/source material that is never served at runtime.
  "public/previews/**",
  "public/learning-folio.jpg",
  "参考/**",
  "参考.af",
  "docker-compose.yml",
  "Dockerfile",
  ".dockerignore",
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
  outputFileTracingIncludes: {
    "/api/*": ["data/sample/*.csv", "data/sample/summary.json"],
  },
  outputFileTracingExcludes: {
    "/*": outputFileTracingExcludes,
  },
};

export default nextConfig;
