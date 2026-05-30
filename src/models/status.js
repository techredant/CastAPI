// models/status.js
const mongoose = require("mongoose");
const statusSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },

    firstName: String,
    companyName: String,
    lastName: String,
    nickName: String,
    image: { type: String, default: "" },

    caption: String,

    views: {
      type: [
        {
          userId: { type: String, required: true },
          viewedAt: { type: Date, default: Date.now },
          firstName: { type: String, default: "" },
          companyName: { type: String, default: "" },
          lastName: { type: String, default: "" },
          nickName: { type: String, default: "" },
          image: { type: String, default: "" },
        },
      ],
      default: [],
    },

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
