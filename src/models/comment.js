const mongoose = require("mongoose");
const { Schema } = mongoose;
const {
  commentToEmbeddingDoc,
  enqueueEmbedding,
} = require("../ai/rag/ingest");

// ------------------- Reply Schema -------------------
const replySchema = new Schema(
  {
    userId: { type: String, required: true }, // Clerk ID
    text: { type: String, required: true },
    likes: { type: [String], default: [] }, // array of userIds who liked
    createdAt: { type: Date, default: Date.now },
    user: {
      clerkId: String,
      firstName: String,
      lastName: String,
      nickName: String,
      companyName: String,
      image: String,
    },
  },
  { _id: true }, // ✅ ensures each reply has its own ObjectId
);

// ------------------- Comment Schema -------------------
const commentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, required: true, ref: "Post" }, // linked to Post
    userId: { type: String, required: true }, // Clerk ID
    text: { type: String, required: true },
    media: { type: [String], default: [] },
    likes: { type: [String], default: [] }, // array of userIds
    replies: { type: [replySchema], default: [] }, // embedded replies
    user: {
      clerkId: String,
      firstName: String,
      lastName: String,
      nickName: String,
      companyName: String,
      image: String,
    },
    aiToxicity: { type: Number, default: 0, index: true },
    aiRiskScore: { type: Number, default: 0, index: true },
    aiAction: {
      type: String,
      enum: ["allow", "shadow", "block", "queue", ""],
      default: "",
      index: true,
    },
    aiLabels: { type: Object, default: {} },
  },
  { timestamps: true }, // adds createdAt & updatedAt
);

commentSchema.index({ text: "text" });

commentSchema.post("save", function enqueueCommentEmbedding(doc) {
  if (!doc?.text) return;
  void enqueueEmbedding(commentToEmbeddingDoc(doc)).catch(() => {});
});

const Comment =
  mongoose.models.Comment || mongoose.model("Comment", commentSchema);

module.exports = Comment;
