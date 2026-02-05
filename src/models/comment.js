const mongoose = require("mongoose");
const { Schema } = mongoose;

// ------------------- Reply Schema -------------------
const replySchema = new Schema(
  {
    userId: { type: String, required: true }, // Clerk ID
    userName: { type: String, required: true },
    text: { type: String, required: true },
    likes: { type: [String], default: [] }, // array of userIds who liked
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true } // ✅ ensures each reply has its own ObjectId
);

// ------------------- Comment Schema -------------------
const commentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, required: true, ref: "Post" }, // linked to Post
    userId: { type: String, required: true }, // Clerk ID
    userName: { type: String, required: true },
    text: { type: String, required: true },
    likes: { type: [String], default: [] }, // array of userIds
    replies: { type: [replySchema], default: [] }, // embedded replies
  },
  { timestamps: true } // adds createdAt & updatedAt
);

const Comment =
  mongoose.models.Comment || mongoose.model("Comment", commentSchema);

module.exports = Comment;
