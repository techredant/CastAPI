// models/post.js
const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true }, // creator of the post/recite/recast
    caption: String,
    media: [String],             // images/videos
    reciteMedia: [String],       // optional media from recite
    levelType: String,
    levelValue: String,
    quote: { type: String, default: "" },    // optional quote
    linkPreview: Object,                     // optional link preview
    likes: { type: [String], default: [] },
    isDeleted: { type: Boolean, default: false },
    
    // Link to the root/original post
    originalPostId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },

    views: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },

    reciteCount: { type: Number, default: 0 },
    recastCount: { type: Number, default: 0 },


    // Optional info if recited or recast
    reciteFirstName: String,
    reciteLastName: String,
    reciteNickName: String,
    reciteImage: String,

    // User info of the person who created this post
    user: {
      clerkId: String,
      firstName: String,
      lastName: String,
      nickName: String,
      image: String,
    },

    type: { type: String, default: "post" }, // "post" | "recast" | "recite"
  },
  { timestamps: true }
);

module.exports = mongoose.model("Post", postSchema);
