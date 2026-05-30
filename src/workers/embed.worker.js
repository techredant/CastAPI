const mongoose = require("mongoose");
const { createWorker } = require("./queue");
const { embedMany, embedText, normalizeText } = require("../ai/providers/embeddings");
const Embedding = require("../models/embedding");
require("dotenv").config();

async function upsertEmbedding(doc) {
  const text = normalizeText(doc.text);
  if (!text) return null;
  const [embedding] = await embedMany([text]);
  return Embedding.findOneAndUpdate(
    { entityType: doc.entityType, entityId: String(doc.entityId) },
    {
      $set: {
        text,
        embedding,
        county: doc.county,
        topics: doc.topics || [],
        metadata: doc.metadata || {},
      },
    },
    { upsert: true, new: true },
  );
}

async function embedQuery(text) {
  return embedText(text);
}

function startEmbedWorker() {
  return createWorker("ai-embeddings", async (job) => {
    if (Array.isArray(job.data?.docs)) {
      return Promise.all(job.data.docs.map(upsertEmbedding));
    }
    return upsertEmbedding(job.data);
  });
}

async function connectAndStart() {
  await mongoose.connect(process.env.MONGO_URI);
  startEmbedWorker();
}

if (require.main === module) {
  connectAndStart().catch((error) => {
    console.error("embed worker failed:", error);
    process.exit(1);
  });
}

module.exports = {
  embedQuery,
  startEmbedWorker,
  upsertEmbedding,
};
