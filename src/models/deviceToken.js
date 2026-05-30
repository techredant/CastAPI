const mongoose = require("mongoose");

const deviceTokenSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true },
    expoPushToken: { type: String, default: null },
    fcmToken: { type: String, default: null, index: true },
    platform: { type: String, enum: ["ios", "android", "web", "unknown"], default: "unknown" },
    appVersion: { type: String, default: null },
    osVersion: { type: String, default: null },
    deviceName: { type: String, default: null },
    active: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

deviceTokenSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
deviceTokenSchema.index({ expoPushToken: 1 });

const DeviceToken =
  mongoose.models.DeviceToken ||
  mongoose.model("DeviceToken", deviceTokenSchema);

module.exports = DeviceToken;
