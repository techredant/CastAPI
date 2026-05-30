const mongoose = require("mongoose");

const livestreamSchema = new mongoose.Schema(
  {
    callId: { type: String, required: true, unique: true, index: true },
    hostUserId: { type: String, required: true, index: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    streamKind: {
      type: String,
      enum: ["community", "market", "debate", "audio"],
      default: "community",
      index: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "live", "ended"],
      default: "scheduled",
      index: true,
    },
    county: { type: String, index: true },
    startedAt: Date,
    endedAt: Date,
    viewerCount: { type: Number, default: 0 },
    aiCaptionsEnabled: { type: Boolean, default: false },
    aiTranscriptUrl: { type: String, default: "" },
    aiTranscriptText: { type: String, default: "" },
    aiSummary: { type: String, default: "" },
    aiLang: { type: String, default: "" },
    aiClips: [
      {
        start: Number,
        end: Number,
        title: String,
        url: String,
        score: Number,
      },
    ],
    aiDebateAnalytics: {
      speakingTime: { type: Object, default: {} },
      interruptions: { type: Number, default: 0 },
      audienceSentiment: { type: Number, default: 0 },
      trendingMoments: { type: [String], default: [] },
    },
  },
  { timestamps: true },
);

livestreamSchema.index({ status: 1, startedAt: -1 });
livestreamSchema.index({ title: "text", description: "text", aiTranscriptText: "text" });

module.exports =
  mongoose.models.Livestream ||
  mongoose.model("Livestream", livestreamSchema);
