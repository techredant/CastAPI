const mongoose = require("mongoose");

const pollVoteSchema = new mongoose.Schema(
  {
    pollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    optionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    levelType: { type: String, default: "" },
    levelValue: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

pollVoteSchema.index({ pollId: 1, userId: 1 }, { unique: true });

const PollVote =
  mongoose.models.PollVote || mongoose.model("PollVote", pollVoteSchema);

module.exports = PollVote;
