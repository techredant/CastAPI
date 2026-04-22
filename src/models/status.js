// models/status.js
const mongoose = require("mongoose");
const statusSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    lastName: { type: String },
    firstName: { type: String },
    nickname: { type: String },

    caption: { type: String },

    views: [
      {
        userId: String,
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    media: [{ type: String }],
    likes: [{ type: String }],
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],

    backgroundColor: {
      type: String,
      default: "#1e293b",
    },

    // ✅ TTL FIELD
    expiresAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24, // 24 hours in seconds
    },
  },
  { timestamps: true },
);

const Status = mongoose.models.Status || mongoose.model("Status", statusSchema);

module.exports = Status;
