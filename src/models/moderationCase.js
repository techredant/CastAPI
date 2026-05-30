const mongoose = require("mongoose");

const moderationCaseSchema = new mongoose.Schema(
  {
    targetType: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },
    authorId: { type: String, index: true },
    text: { type: String, default: "" },
    reasons: { type: [String], default: [] },
    labels: { type: Object, default: {} },
    severity: { type: Number, default: 0, index: true },
    action: {
      type: String,
      enum: ["allow", "shadow", "block", "queue"],
      default: "allow",
      index: true,
    },
    judge: {
      type: String,
      enum: ["ai", "human"],
      default: "ai",
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "resolved", "appealed"],
      default: "open",
      index: true,
    },
    reviewerId: String,
    notes: String,
    appealStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },
  },
  { timestamps: true },
);

moderationCaseSchema.index({ createdAt: -1 });
moderationCaseSchema.index({ action: 1, severity: -1, createdAt: -1 });

module.exports =
  mongoose.models.ModerationCase ||
  mongoose.model("ModerationCase", moderationCaseSchema);
