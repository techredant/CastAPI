const mongoose = require("mongoose");

const pollOptionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, maxlength: 100, trim: true },
    voteCount: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const pollSchema = new mongoose.Schema(
  {
    creatorId: { type: String, required: true, index: true },
    question: { type: String, required: true, maxlength: 280, trim: true },
    options: {
      type: [pollOptionSchema],
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length >= 2 && v.length <= 4;
        },
        message: "Polls need 2–4 options",
      },
    },
    levelType: {
      type: String,
      enum: ["national", "home", "county", "constituency", "ward", "organization"],
      required: true,
      index: true,
    },
    levelValue: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    isAnonymous: { type: Boolean, default: false },
    verifiedOnly: { type: Boolean, default: false },
    liveCallId: { type: String, default: null, index: true },
    status: {
      type: String,
      enum: ["active", "closed"],
      default: "active",
      index: true,
    },
    totalVotes: { type: Number, default: 0, min: 0 },
    shareCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    trendingScore: { type: Number, default: 0 },
    votesLast24h: { type: Number, default: 0 },
    closedAt: { type: Date, default: null },
    endingNotified: { type: Boolean, default: false },
    creator: {
      clerkId: String,
      firstName: String,
      lastName: String,
      nickName: String,
      companyName: String,
      image: String,
      isVerified: { type: Boolean, default: false },
      verificationType: String,
    },
  },
  { timestamps: true },
);

pollSchema.index({ status: 1, levelType: 1, levelValue: 1, createdAt: -1 });
pollSchema.index({ status: 1, trendingScore: -1, createdAt: -1 });
pollSchema.index({ status: 1, expiresAt: 1 });

const Poll = mongoose.models.Poll || mongoose.model("Poll", pollSchema);

module.exports = Poll;
