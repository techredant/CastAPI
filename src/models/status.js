// models/status.js
const mongoose = require("mongoose");

const statusSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    lastName: { type: String },
    firstName: { type: String },
    nickname: { type: String },
    caption: { type: String },
    media: [{ type: String }],
    likes: [{ type: String }],
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    backgroundColor: {
      type: String,
      default: "#1e293b",
    },
  },
  { timestamps: true },
);

const Status = mongoose.models.Status || mongoose.model("Status", statusSchema);

module.exports = Status;
