const mongoose = require("mongoose");

const aiAuditLogSchema = new mongoose.Schema(
  {
    feature: { type: String, required: true, index: true },
    model: { type: String, required: true, index: true },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    userId: { type: String, index: true },
    requestId: { type: String, index: true },
  },
  { timestamps: true },
);

aiAuditLogSchema.index({ createdAt: -1 });
aiAuditLogSchema.index({ feature: 1, createdAt: -1 });

module.exports =
  mongoose.models.AiAuditLog ||
  mongoose.model("AiAuditLog", aiAuditLogSchema);
