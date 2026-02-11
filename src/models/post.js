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
     quote: { type: String, default: "" },
      originalPostId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
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
