const mongoose = require("mongoose");

const interactionLogSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", index: true },
    action: {
      type: String,
      enum: ["view", "like", "recite", "recast", "comment", "dwell", "hide"],
      required: true,
      index: true,
    },
    dwellMs: { type: Number, default: 0 },
    county: { type: String, index: true },
    topics: { type: [String], default: [] },
    value: { type: Number, default: 1 },
    ts: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

interactionLogSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
interactionLogSchema.index({ userId: 1, ts: -1 });

module.exports =
  mongoose.models.InteractionLog ||
  mongoose.model("InteractionLog", interactionLogSchema);
