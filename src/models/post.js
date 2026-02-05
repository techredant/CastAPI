const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    caption: String,
    media: [String],
    levelType: String,
    levelValue: String,
    linkPreview: Object,
    likes: { type: [String], default: [] },
    isDeleted: { type: Boolean, default: false },
    recasts: [
      {
        userId: { type: String, required: true },
        nickname: { type: String, required: true },
        quote: { type: String, default: "" },
        recastedAt: { type: Date, default: Date.now },
      },
    ],
    views: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    user: {
      clerkId: String,
      firstName: String,
      lastName: String,
      nickName: String,
      image: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Post", postSchema);
