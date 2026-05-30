const mongoose = require("mongoose");

const liveReactionSchema = new mongoose.Schema(
  {
    livestreamId: { type: String, required: true, index: true },
    reactionType: {
      type: String,
      required: true,
      enum: ["heart", "like", "fire", "laugh"],
    },
    count: { type: Number, default: 0 },
  },
  { timestamps: true },
);

liveReactionSchema.index(
  { livestreamId: 1, reactionType: 1 },
  { unique: true },
);

module.exports = mongoose.model("LiveReaction", liveReactionSchema);
