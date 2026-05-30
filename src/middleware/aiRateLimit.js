const { getRestRedis } = require("../workers/queue");

const memoryBuckets = new Map();

function getUserKey(req) {
  return (
    req.headers["x-user-id"] ||
    req.body?.userId ||
    req.body?.user_id ||
    req.query?.userId ||
    req.query?.user_id ||
    req.ip ||
    "anonymous"
  );
}

function limitFor(req) {
  const role = String(req.headers["x-ai-tier"] || "").toLowerCase();
  if (role === "verified" || role === "admin") return 600;
  return Number(process.env.AI_RATE_LIMIT_PER_MIN || 60);
}

async function memoryLimit(key, limit) {
  const now = Date.now();
  const resetAt = now + 60_000;
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    memoryBuckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

function aiRateLimit() {
  return async (req, res, next) => {
    const limit = limitFor(req);
    const userKey = String(getUserKey(req));
    const key = `ai:rate:${userKey}:${Math.floor(Date.now() / 60_000)}`;

    try {
      const redis = getRestRedis();
      let state;
      if (redis) {
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, 60);
        state = {
          allowed: count <= limit,
          remaining: Math.max(0, limit - count),
          resetAt: Date.now() + 60_000,
        };
      } else {
        state = await memoryLimit(key, limit);
      }

      res.setHeader("X-AI-RateLimit-Limit", String(limit));
      res.setHeader("X-AI-RateLimit-Remaining", String(state.remaining));
      if (!state.allowed) {
        return res.status(429).json({
          error: "AI rate limit exceeded",
          retryAfterMs: Math.max(0, state.resetAt - Date.now()),
        });
      }
      return next();
    } catch (error) {
      console.error("AI rate limiter failed:", error.message);
      return next();
    }
  };
}

module.exports = aiRateLimit;
