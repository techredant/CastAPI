const mongoose = require("mongoose");

const pollCommentSchema = new mongoose.Schema(
  {
    pollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    text: { type: String, required: true, maxlength: 500, trim: true },
    likes: { type: [String], default: [] },
    user: {
      clerkId: String,
      firstName: String,
      lastName: String,
      nickName: String,
      companyName: String,
      image: String,
      isVerified: { type: Boolean, default: false },
      verificationType: String,
    },
  },
  { timestamps: true },
);

const PollComment =
  mongoose.models.PollComment ||
  mongoose.model("PollComment", pollCommentSchema);

module.exports = PollComment;
