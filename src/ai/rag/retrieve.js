const Embedding = require("../../models/embedding");
const { embedText } = require("../providers/embeddings");

function reciprocalRankFusion(lists, k = 60) {
  const scores = new Map();
  for (const list of lists) {
    list.forEach((item, index) => {
      const id = `${item.entityType}:${item.entityId}`;
      const prev = scores.get(id) || { item, score: 0 };
      prev.score += 1 / (k + index + 1);
      scores.set(id, prev);
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({ ...entry.item, rrfScore: entry.score }));
}

async function vectorSearch({ query, entityTypes, county, limit = 20 }) {
  const vector = await embedText(query);
  if (!vector.length) return [];

  const filter = {};
  if (entityTypes?.length) filter.entityType = { $in: entityTypes };
  if (county) filter.county = county;

  try {
    return Embedding.aggregate([
      {
        $vectorSearch: {
          index: process.env.ATLAS_VECTOR_INDEX || "embedding_vector_index",
          path: "embedding",
          queryVector: vector,
          numCandidates: 150,
          limit,
          ...(Object.keys(filter).length ? { filter } : {}),
        },
      },
      { $addFields: { vectorScore: { $meta: "vectorSearchScore" } } },
    ]);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Atlas vector search unavailable, falling back to text search:", error.message);
    }
    return [];
  }
}

async function textSearch({ query, entityTypes, county, limit = 20 }) {
  const filter = { $text: { $search: query } };
  if (entityTypes?.length) filter.entityType = { $in: entityTypes };
  if (county) filter.county = county;
  try {
    return Embedding.find(filter, { score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .lean();
  } catch {
    return Embedding.find({
      ...(entityTypes?.length ? { entityType: { $in: entityTypes } } : {}),
      ...(county ? { county } : {}),
      text: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    })
      .limit(limit)
      .lean();
  }
}

async function retrieveContext({ query, entityTypes, county, limit = 8 }) {
  const [vectors, texts] = await Promise.all([
    vectorSearch({ query, entityTypes, county, limit: 20 }),
    textSearch({ query, entityTypes, county, limit: 20 }),
  ]);
  return reciprocalRankFusion([vectors, texts]).slice(0, limit);
}

module.exports = {
  reciprocalRankFusion,
  retrieveContext,
  textSearch,
  vectorSearch,
};
