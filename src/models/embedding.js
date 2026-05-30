const mongoose = require("mongoose");

const embeddingSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ["post", "comment", "news", "politician", "manifesto", "product"],
      required: true,
      index: true,
    },
    entityId: { type: String, required: true, index: true },
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    county: { type: String, index: true },
    topics: { type: [String], default: [] },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

embeddingSchema.index({ entityType: 1, entityId: 1 }, { unique: true });
embeddingSchema.index({ text: "text", "metadata.title": "text" });

module.exports =
  mongoose.models.Embedding || mongoose.model("Embedding", embeddingSchema);
