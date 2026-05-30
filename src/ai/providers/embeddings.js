const crypto = require("crypto");
const OpenAI = require("openai");
const { OPENROUTER_BASE_URL } = require("../../config/aiModels");
const { getCache, setCache } = require("../../workers/queue");

const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBED_MODEL?.trim() ||
  process.env.AI_EMBEDDING_MODEL?.trim() ||
  "openai/text-embedding-3-small";

let client = null;

function getEmbeddingClient() {
  if (client) return client;
  const apiKey =
    process.env.OPEN_ROUTER_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing OPEN_ROUTER_API_KEY or OPENAI_API_KEY");
  }
  client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || OPENROUTER_BASE_URL,
  });
  return client;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 8000);
}

function cacheKey(text) {
  return `ai:embedding:${crypto
    .createHash("sha256")
    .update(normalizeText(text))
    .digest("hex")}`;
}

async function embedText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const key = cacheKey(normalized);
  const cached = await getCache(key);
  if (Array.isArray(cached)) return cached;

  const response = await getEmbeddingClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: normalized,
  });
  const embedding = response.data?.[0]?.embedding || [];
  await setCache(key, embedding, 60 * 60 * 24 * 30);
  return embedding;
}

async function embedMany(texts) {
  const normalized = texts.map(normalizeText);
  const results = new Array(normalized.length);
  const misses = [];
  const missIndexes = [];

  for (let i = 0; i < normalized.length; i += 1) {
    const cached = await getCache(cacheKey(normalized[i]));
    if (Array.isArray(cached)) {
      results[i] = cached;
    } else if (normalized[i]) {
      missIndexes.push(i);
      misses.push(normalized[i]);
    } else {
      results[i] = [];
    }
  }

  if (misses.length) {
    const response = await getEmbeddingClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: misses,
    });
    await Promise.all(
      (response.data || []).map(async (row, idx) => {
        const originalIndex = missIndexes[idx];
        const embedding = row.embedding || [];
        results[originalIndex] = embedding;
        await setCache(cacheKey(normalized[originalIndex]), embedding, 60 * 60 * 24 * 30);
      }),
    );
  }

  return results;
}

module.exports = {
  EMBEDDING_MODEL,
  embedMany,
  embedText,
  normalizeText,
};
