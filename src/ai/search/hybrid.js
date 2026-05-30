const { completeJson, sanitizePromptInput, tieredModel } = require("../providers/llm");
const { retrieveContext } = require("../rag/retrieve");
const { getCache, setCache } = require("../../workers/queue");

async function rerank({ query, results, userId }) {
  if (!results.length || !process.env.OPEN_ROUTER_API_KEY) return results;
  const response = await completeJson({
    model: tieredModel("fast"),
    feature: "search_rerank",
    userId,
    messages: [
      {
        role: "system",
        content:
          "Return JSON {\"rankedIds\":[\"entityType:entityId\"]}. Rerank by relevance, civic value, recency, county match, and lower risk.",
      },
      {
        role: "user",
        content: JSON.stringify({
          query: sanitizePromptInput(query),
          results: results.map((item) => ({
            id: `${item.entityType}:${item.entityId}`,
            title: item.metadata?.title,
            text: String(item.text || "").slice(0, 600),
            county: item.county,
          })),
        }),
      },
    ],
    temperature: 0,
  });
  const rankedIds = response.json?.rankedIds;
  if (!Array.isArray(rankedIds)) return results;
  const byId = new Map(results.map((item) => [`${item.entityType}:${item.entityId}`, item]));
  const ranked = rankedIds.map((id) => byId.get(id)).filter(Boolean);
  const remaining = results.filter((item) => !rankedIds.includes(`${item.entityType}:${item.entityId}`));
  return [...ranked, ...remaining];
}

async function hybridSearch({ query, type = "auto", county, limit = 10, userId }) {
  const key = `ai:search:${userId || "anon"}:${county || "all"}:${type}:${query}`;
  const cached = await getCache(key);
  if (cached) return cached;

  const entityTypes =
    type === "auto" || !type
      ? undefined
      : String(type)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
  const fused = await retrieveContext({ query, entityTypes, county, limit: 20 });
  const ranked = await rerank({ query, results: fused, userId });
  const results = ranked.slice(0, limit).map((item) => ({
    id: `${item.entityType}:${item.entityId}`,
    entityType: item.entityType,
    entityId: item.entityId,
    title: item.metadata?.title || item.entityType,
    excerpt: String(item.text || "").slice(0, 280),
    county: item.county,
    metadata: item.metadata || {},
    score: item.rrfScore || item.vectorScore || item.score || 0,
  }));
  await setCache(key, results, 300);
  return results;
}

module.exports = {
  hybridSearch,
  rerank,
};
