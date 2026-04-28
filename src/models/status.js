// models/status.js
const mongoose = require("mongoose");
const statusSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },

    firstName: String,
    lastName: String,
    nickName: String,

    caption: String,

    // ✅ IMPORTANT: views schema
    views: [
      {
        userId: { type: String, required: true },
        viewedAt: { type: Date, default: Date.now },
      },
    ],

    media: { type: [String], default: [] },
    likes: { type: [String], default: [] },

    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],

    backgroundColor: {
      type: String,
      default: "#1e293b",
    },

    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      expires: 0,
    },
  },
  { timestamps: true },
);

const Status = mongoose.models.Status || mongoose.model("Status", statusSchema);

module.exports = Status;
