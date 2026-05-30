const mongoose = require("mongoose");
const {
  enqueueEmbedding,
  newsToEmbeddingDoc,
} = require("../ai/rag/ingest");

const newsSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  image: String,
  createdAt: { type: Date, default: Date.now },
});

newsSchema.index({ title: "text", content: "text" });
newsSchema.post("save", function enqueueNewsEmbedding(doc) {
  if (!doc?.title && !doc?.content) return;
  void enqueueEmbedding(newsToEmbeddingDoc(doc)).catch(() => {});
});

module.exports = mongoose.model("News", newsSchema);
