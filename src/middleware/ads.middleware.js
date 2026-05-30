const clickBuckets = new Map();
const impressionBuckets = new Map();

const WINDOW_MS = 60_000;
const MAX_CLICKS_PER_WINDOW = 8;
const MAX_IMPRESSIONS_PER_WINDOW = 40;

function pruneBucket(bucket, now) {
  const cutoff = now - WINDOW_MS;
  while (bucket.length && bucket[0] < cutoff) {
    bucket.shift();
  }
}

function rateLimit(map, key, max) {
  const now = Date.now();
  if (!map.has(key)) map.set(key, []);
  const bucket = map.get(key);
  pruneBucket(bucket, now);
  if (bucket.length >= max) return false;
  bucket.push(now);
  return true;
}

function adsRateLimit(type) {
  return (req, res, next) => {
    const viewerId =
      req.body?.viewerClerkId ||
      req.query?.viewerClerkId ||
      req.ip ||
      "anon";
    const adId = req.body?.adId || req.params?.adId || "global";
    const key = `${type}:${viewerId}:${adId}`;

    const map = type === "click" ? clickBuckets : impressionBuckets;
    const max =
      type === "click" ? MAX_CLICKS_PER_WINDOW : MAX_IMPRESSIONS_PER_WINDOW;

    if (!rateLimit(map, key, max)) {
      return res.status(429).json({
        message: "Too many requests — please slow down",
        fraudSuspect: true,
      });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_API_KEY || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

module.exports = {
  adsRateLimit,
  requireAdmin,
};
