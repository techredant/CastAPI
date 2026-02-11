const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    caption: String,
    media: [String],
    reciteMedia: [String],

    levelType: String,
    levelValue: String,

    quote: { type: String, default: "" },
    quoteCount: { type: Number, default: 0 },

    linkPreview: Object,
    likes: { type: [String], default: [] },
    isDeleted: { type: Boolean, default: false },

    originalPostId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },

    views: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },

    // Recite user info
    reciteFirstName: String,
    reciteLastName: String,
    reciteNickName: String,
    reciteImage: String,

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
