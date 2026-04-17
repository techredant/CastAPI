const postSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },

    caption: String,

    // ✅ media
    media: {
      type: [String],
      default: [],
    },

    reciteMedia: {
      type: [String],
      default: [],
    },

    // ✅ NEW (important)
    contentType: {
      type: String,
      enum: ["text", "media"],
      default: "text",
      index: true,
    },

    levelType: String,
    levelValue: String,

    quote: { type: String, default: "" },
    linkPreview: Object,

    likes: { type: [String], default: [] },
    isDeleted: { type: Boolean, default: false, index: true },

    originalPostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },

    views: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },

    reciteCount: { type: Number, default: 0 },
    recastCount: { type: Number, default: 0 },

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
      accountType: String,
    },

    // ✅ post behavior (keep this separate)
    type: {
      type: String,
      enum: ["post", "recast", "recite"],
      default: "post",
      index: true,
    },
  },
  { timestamps: true },
);


postSchema.index({
  contentType: 1,
  levelType: 1,
  levelValue: 1,
  createdAt: -1,
});