const mongoose = require("mongoose");

const userPresenceSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    lastSeenAt: { type: Date, required: true, index: true },
  },
  { timestamps: false },
);

module.exports = mongoose.model("UserPresence", userPresenceSchema);
