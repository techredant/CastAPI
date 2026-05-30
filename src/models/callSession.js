const mongoose = require("mongoose");

const callSessionSchema = new mongoose.Schema(
  {
    channelName: { type: String, required: true, unique: true, index: true },
    callerId: { type: String, required: true, index: true },
    memberIds: { type: [String], default: [] },
    callMode: { type: String, enum: ["video", "audio"], default: "video" },
    status: {
      type: String,
      enum: ["ringing", "active", "ended"],
      default: "ringing",
      index: true,
    },
    channelCid: { type: String, default: "" },
    acceptedBy: { type: [String], default: [] },
    endedReason: { type: String, default: "" },
    endedAt: Date,
  },
  { timestamps: true },
);

callSessionSchema.index({ status: 1, updatedAt: -1 });

module.exports =
  mongoose.models.CallSession ||
  mongoose.model("CallSession", callSessionSchema);
