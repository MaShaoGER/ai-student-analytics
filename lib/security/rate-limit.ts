/**
 * Simple in-memory rate limiter for API endpoints.
 * Tracks requests per IP address in sliding windows.
 *
 * Note: For distributed/production deployment, use Redis or similar.
 * This implementation is suitable for single-server MVP.
 */

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitRecord {
  timestamps: number[];
}

const store = new Map<string, RateLimitRecord>();

// Cleanup old entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    record.timestamps = record.timestamps.filter(
      (ts) => now - ts < CLEANUP_INTERVAL * 2
    );
    if (record.timestamps.length === 0) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

export function extractClientId(request: Request): string {
  // In production, consider X-Forwarded-For behind a proxy
  // For now, use a simple identifier
  return request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAfter: number; // milliseconds until reset
}

/**
 * Check if a request should be allowed based on rate limits.
 */
export function checkRateLimit(
  clientId: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let record = store.get(clientId);
  if (!record) {
    record = { timestamps: [] };
    store.set(clientId, record);
  }

  // Remove timestamps outside the window
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  const currentCount = record.timestamps.length;
  const allowed = currentCount < config.maxRequests;

  if (allowed) {
    record.timestamps.push(now);
  }

  // Calculate when the oldest request in the window expires
  const oldestTimestamp = record.timestamps[0] || now;
  const resetAfter = Math.max(0, oldestTimestamp + config.windowMs - now);

  return {
    allowed,
    remaining: Math.max(0, config.maxRequests - record.timestamps.length),
    resetAfter,
  };
}

/**
 * Standard rate limit configs
 */
export const rateLimitConfigs = {
  // Analysis endpoint: 30 requests per minute
  analysis: {
    windowMs: 60 * 1000,
    maxRequests: 30,
  },
  // Ask endpoint: 20 requests per minute (higher cost due to AI)
  ask: {
    windowMs: 60 * 1000,
    maxRequests: 20,
  },
  // Profile endpoint: 60 requests per minute
  profile: {
    windowMs: 60 * 1000,
    maxRequests: 60,
  },
  // Strict limit for suspected abuse: 5 per minute
  strict: {
    windowMs: 60 * 1000,
    maxRequests: 5,
  },
};
