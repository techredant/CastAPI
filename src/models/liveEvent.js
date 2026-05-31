const mongoose = require("mongoose");

const liveEventSchema = new mongoose.Schema(
  {
    callId: { type: String, required: true, index: true },
    eventType: { type: String, required: true, index: true },
    eventId: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

liveEventSchema.index({ callId: 1, eventId: 1 }, { unique: true });
liveEventSchema.index({ callId: 1, createdAt: 1 });
liveEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 6 * 60 * 60 });

module.exports =
  mongoose.models.LiveEvent ||
  mongoose.model("LiveEvent", liveEventSchema);
