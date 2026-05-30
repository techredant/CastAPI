const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const { Redis } = require("@upstash/redis");

const redisUrl =
  process.env.AI_REDIS_URL?.trim() ||
  process.env.REDIS_URL?.trim() ||
  "";

let bullConnection = null;
let restRedis = null;
const memoryCache = new Map();

function getBullConnection() {
  if (!redisUrl) return null;
  if (bullConnection) return bullConnection;
  bullConnection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: redisUrl.startsWith("rediss://") ? {} : undefined,
  });
  return bullConnection;
}

function getRestRedis() {
  if (restRedis) return restRedis;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  restRedis = new Redis({ url, token });
  return restRedis;
}

function createQueue(name) {
  const connection = getBullConnection();
  if (!connection) {
    return {
      async add(_jobName, data) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`Queue ${name} disabled; job skipped`);
        }
        return { id: `memory-${Date.now()}`, data };
      },
    };
  }
  return new Queue(name, { connection });
}

function createWorker(name, processor, options = {}) {
  const connection = getBullConnection();
  if (!connection) {
    console.warn(`Worker ${name} disabled because AI_REDIS_URL/REDIS_URL is missing`);
    return null;
  }
  return new Worker(name, processor, { connection, concurrency: 3, ...options });
}

async function getCache(key) {
  const redis = getRestRedis();
  if (redis) return redis.get(key);
  const item = memoryCache.get(key);
  if (!item) return null;
  if (item.expiresAt && item.expiresAt < Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return item.value;
}

async function setCache(key, value, ttlSeconds = 300) {
  const redis = getRestRedis();
  if (redis) {
    await redis.set(key, value, { ex: ttlSeconds });
    return;
  }
  memoryCache.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
}

const queues = {
  embeddings: createQueue("ai-embeddings"),
  moderation: createQueue("ai-moderation"),
  live: createQueue("ai-live"),
  clips: createQueue("ai-clips"),
  digest: createQueue("ai-digest"),
};

module.exports = {
  createQueue,
  createWorker,
  getBullConnection,
  getCache,
  getRestRedis,
  queues,
  setCache,
};
