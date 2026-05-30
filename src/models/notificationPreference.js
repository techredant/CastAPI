const mongoose = require("mongoose");

const defaultPreferences = {
  social: true,
  messages: true,
  marketplace: true,
  livestreams: true,
  system: true,
  calls: true,
};

const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    enabled: {
      social: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
      marketplace: { type: Boolean, default: true },
      livestreams: { type: Boolean, default: true },
      system: { type: Boolean, default: true },
      calls: { type: Boolean, default: true },
    },
    mutedUsers: { type: [String], default: [] },
    mutedGroups: { type: [String], default: [] },
    quietHours: {
      enabled: { type: Boolean, default: false },
      start: { type: String, default: "22:00" },
      end: { type: String, default: "07:00" },
      timezone: { type: String, default: "UTC" },
    },
    sounds: {
      social: { type: String, default: "default" },
      messages: { type: String, default: "default" },
      marketplace: { type: String, default: "default" },
      livestreams: { type: String, default: "default" },
      system: { type: String, default: "default" },
      calls: { type: String, default: "default" },
    },
    vibration: { type: Boolean, default: true },
    showPreviews: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const NotificationPreference =
  mongoose.models.NotificationPreference ||
  mongoose.model("NotificationPreference", notificationPreferenceSchema);

module.exports = NotificationPreference;
module.exports.defaultPreferences = defaultPreferences;
