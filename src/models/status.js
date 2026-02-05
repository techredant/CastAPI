// models/status.js
const mongoose = require("mongoose");

const statusSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    userName: { type: String },
    firstName: { type: String },
    nickname: { type: String },
    caption: { type: String },
    media: [{ type: String }],
    likes: [{ type: String }],
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
  },
  { timestamps: true }
);

const Status = mongoose.models.Status || mongoose.model("Status", statusSchema);

module.exports = Status;
