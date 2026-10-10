import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit, extractClientId, rateLimitConfigs } from "./rate-limit";

describe("rate limiting", () => {
  beforeEach(() => {
    // Note: In a real test, we'd clear the store between tests
    // For now, we use unique client IDs
    vi.clearAllTimers();
  });

  it("should allow requests within the limit", () => {
    const result1 = checkRateLimit("client-1", rateLimitConfigs.analysis);
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(29);

    const result2 = checkRateLimit("client-1", rateLimitConfigs.analysis);
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(28);
  });

  it("should reject requests exceeding the limit", () => {
    const config = { windowMs: 60000, maxRequests: 3 };

    // Use unique ID for this test
    const clientId = "test-reject-" + Date.now();

    for (let i = 0; i < 3; i++) {
      const result = checkRateLimit(clientId, config);
      expect(result.allowed).toBe(true);
    }

    const result4 = checkRateLimit(clientId, config);
    expect(result4.allowed).toBe(false);
    expect(result4.remaining).toBe(0);
  });

  it("should track remaining requests accurately", () => {
    const clientId = "test-remaining-" + Date.now();
    const config = { windowMs: 60000, maxRequests: 5 };

    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(clientId, config);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it("should provide resetAfter time", () => {
    const clientId = "test-reset-" + Date.now();
    const config = { windowMs: 1000, maxRequests: 1 };

    const result1 = checkRateLimit(clientId, config);
    expect(result1.resetAfter).toBeGreaterThan(0);
    expect(result1.resetAfter).toBeLessThanOrEqual(config.windowMs);

    const result2 = checkRateLimit(clientId, config);
    expect(result2.allowed).toBe(false);
  });

  it("should support multiple clients independently", () => {
    const config = { windowMs: 60000, maxRequests: 2 };

    const client1Result1 = checkRateLimit("client-a", config);
    expect(client1Result1.allowed).toBe(true);
    expect(client1Result1.remaining).toBe(1);

    const client2Result1 = checkRateLimit("client-b", config);
    expect(client2Result1.allowed).toBe(true);
    expect(client2Result1.remaining).toBe(1);

    // Each client still has requests available
    const client1Result2 = checkRateLimit("client-a", config);
    expect(client1Result2.allowed).toBe(true);

    const client2Result2 = checkRateLimit("client-b", config);
    expect(client2Result2.allowed).toBe(true);

    // Third request should be blocked for each
    const client1Result3 = checkRateLimit("client-a", config);
    expect(client1Result3.allowed).toBe(false);

    const client2Result3 = checkRateLimit("client-b", config);
    expect(client2Result3.allowed).toBe(false);
  });

  it("should use standard configs", () => {
    expect(rateLimitConfigs.analysis.maxRequests).toBe(30);
    expect(rateLimitConfigs.ask.maxRequests).toBe(20);
    expect(rateLimitConfigs.profile.maxRequests).toBe(60);
    expect(rateLimitConfigs.strict.maxRequests).toBe(5);
  });

  describe("extractClientId", () => {
    it("should extract x-forwarded-for header", () => {
      const request = new Request("http://localhost", {
        headers: { "x-forwarded-for": "192.168.1.1" },
      });
      expect(extractClientId(request)).toBe("192.168.1.1");
    });

    it("should fall back to x-real-ip header", () => {
      const request = new Request("http://localhost", {
        headers: { "x-real-ip": "10.0.0.1" },
      });
      expect(extractClientId(request)).toBe("10.0.0.1");
    });

    it("should use unknown if no headers present", () => {
      const request = new Request("http://localhost");
      expect(extractClientId(request)).toBe("unknown");
    });

    it("should prefer x-forwarded-for over x-real-ip", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "192.168.1.1",
          "x-real-ip": "10.0.0.1",
        },
      });
      expect(extractClientId(request)).toBe("192.168.1.1");
    });
  });
});
