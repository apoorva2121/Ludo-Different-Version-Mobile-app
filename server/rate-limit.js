'use strict';

// Development-safe local limiter. Production should replace this with a
// shared store/edge limiter so limits work across server instances.
class RateLimiter {
  constructor({ windowMs = 60_000, max = 120 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.buckets = new Map();
  }

  allow(key) {
    const now = Date.now();
    const current = this.buckets.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= this.max) return false;
    current.count += 1;
    return true;
  }

  prune() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, bucket] of this.buckets) if (bucket.startedAt < cutoff) this.buckets.delete(key);
  }
}

module.exports = { RateLimiter };

