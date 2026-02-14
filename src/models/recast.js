const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true }, // the user who created or recast

    caption: String,
    media: [String],
    reciteMedia: [String], // optional media from recite

    levelType: String,
    levelValue: String,

    quote: { type: String, default: "" }, // quote text if any

    linkPreview: Object, // optional link preview

    likes: { type: [String], default: [] },
    isDeleted: { type: Boolean, default: false },

    // Link to the root/original post
    originalPostId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },

    views: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },

    // Optional info if recited or recast
    reciteFirstName: String,
    reciteLastName: String,
    reciteNickName: String,
    reciteImage: String,

    // User info of the person who posted this recast/post
    user: {
      clerkId: String,
      firstName: String,
      lastName: String,
      nickName: String,
      image: String,
    },

    type: { type: String, default: "recast" }, // "post" | "recast" | "recite"
  },
  { timestamps: true }
);

module.exports = mongoose.model("Recast", postSchema);
