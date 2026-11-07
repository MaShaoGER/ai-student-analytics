import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "./proxy";

const requestFor = (path: string) =>
  new NextRequest(new URL(path, "http://localhost"));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("preview proxy matcher", () => {
  it.each(["/preview", "/preview/ai-experience", "/previews", "/previews/x/y"])(
    "matches %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    }
  );

  it.each([
    "/",
    "/api/chat",
    "/knowledge/teaching",
    "/_next/static/chunk.js",
    "/previewing",
    "/previewing/notes",
    "/previewsx",
  ])("does not match %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});

describe("preview proxy behavior", () => {
  it("passes through with noindex headers in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = proxy(requestFor("/preview/ai-experience"));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("returns 404 without reopenable switches outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(requestFor("/preview/ai-experience"));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("treats test environment as closed", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(proxy(requestFor("/previews")).status).toBe(404);
  });
});
