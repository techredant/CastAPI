const mongoose = require("mongoose");
const {
  enqueueEmbedding,
  postToEmbeddingDoc,
} = require("../ai/rag/ingest");

const postSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },

    caption: { type: String, default: "" },
    mentions: [
  {
    userId: String,
    nickName: String,
  }
],

    media: {
      type: [String],
      default: [],
    },

    reciteMedia: {
      type: [String],
      default: [],
    },

    levelType: { type: String, default: "" },
    levelValue: { type: String, default: "" },

    quote: { type: String, default: "" },

    linkPreview: [
      {
        title: String,
        description: String,
        image: String,
        url: String,
      },
    ],

    likes: { type: [String], default: [] },

    isDeleted: { type: Boolean, default: false },

    originalPostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },

    views: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    reciteCount: { type: Number, default: 0 },
    recastCount: { type: Number, default: 0 },

    isEdited: { type: Boolean, default: false },
    editedAt: Date,

    reciteUserId: String,
    reciteFirstName: String,
    reciteLastName: String,
    reciteNickName: String,
    reciteImage: String,
    reciteCompanyName: String,

    user: {
      clerkId: String,
      firstName: String,
      lastName: String,
      nickName: String,
      companyName: String,
      image: String,
      accountType: String,
      isVerified: { type: Boolean, default: false },
      verificationType: { type: String, default: "" },
    },

    type: {
      type: String,
      enum: ["post", "recast", "recite"],
      immutable: true,
      default: "post",
    },
    aiTopics: { type: [String], default: [] },
    aiRiskScore: { type: Number, default: 0, index: true },
    aiEmbeddingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Embedding",
      default: null,
    },
    aiSensitive: { type: Boolean, default: false, index: true },
    aiLang: { type: String, default: "" },
    aiModerationAction: {
      type: String,
      enum: ["allow", "shadow", "block", "queue", ""],
      default: "",
      index: true,
    },
  },
  { timestamps: true },
);

postSchema.index({ createdAt: -1, _id: -1 });
postSchema.index({ levelType: 1, isDeleted: 1, createdAt: -1, _id: -1 });
postSchema.index({
  levelType: 1,
  levelValue: 1,
  isDeleted: 1,
  createdAt: -1,
  _id: -1,
});
postSchema.index({ originalPostId: 1, quote: 1 });
postSchema.index({ userId: 1 });
postSchema.index({ levelValue: 1, createdAt: -1 });
postSchema.index({ aiTopics: 1 });

postSchema.post("save", function enqueuePostEmbedding(doc) {
  if (!doc?.caption && !doc?.quote) return;
  void enqueueEmbedding(postToEmbeddingDoc(doc)).catch(() => {});
});

module.exports = mongoose.model("Post", postSchema);
