// In-memory sliding-window rate limiter.
// Suitable for single-instance deployments (Vercel serverless functions
// share memory within a warm instance but reset between cold starts).
// For multi-instance, replace with Redis or DB-backed counter.

const buckets = new Map();

const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > bucket.windowMs * 2) {
      buckets.delete(key);
    }
  }
}

/**
 * Check if a request should be rate-limited.
 *
 * @param {string} key — unique identifier (e.g. empresa_id, IP, or "ip:endpoint")
 * @param {number} maxRequests — max requests per window
 * @param {number} windowMs — window size in milliseconds
 * @returns {{ limited: boolean, remaining: number, resetMs: number }}
 */
export function checkRateLimit(key, maxRequests, windowMs) {
  cleanup();
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now, windowMs };
    buckets.set(key, bucket);
  }

  bucket.count++;

  if (bucket.count > maxRequests) {
    const resetMs = bucket.windowStart + windowMs - now;
    return { limited: true, remaining: 0, resetMs };
  }

  return {
    limited: false,
    remaining: maxRequests - bucket.count,
    resetMs: bucket.windowStart + windowMs - now,
  };
}

// For testing
export function _resetBuckets() {
  buckets.clear();
}
