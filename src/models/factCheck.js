const mongoose = require("mongoose");

const factCheckSchema = new mongoose.Schema(
  {
    targetType: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },
    claim: { type: String, required: true },
    verdict: {
      type: String,
      enum: ["true", "false", "misleading", "unverified"],
      default: "unverified",
      index: true,
    },
    evidence: [
      {
        title: String,
        url: String,
        excerpt: String,
        source: String,
      },
    ],
    confidence: { type: Number, default: 0 },
    riskScore: { type: Number, default: 0, index: true },
    reviewerId: String,
    status: {
      type: String,
      enum: ["draft", "queued", "published", "rejected"],
      default: "queued",
      index: true,
    },
  },
  { timestamps: true },
);

factCheckSchema.index({ claim: "text", "evidence.excerpt": "text" });

module.exports =
  mongoose.models.FactCheck || mongoose.model("FactCheck", factCheckSchema);
