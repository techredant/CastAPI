const mongoose = require("mongoose");
const { Schema } = mongoose;

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
    likes: { type: [String], default: [] }, // array of userIds
    replies: { type: [replySchema], default: [] }, // embedded replies
    user: {
      clerkId: String,
      firstName: String,
      lastName: String,
      nickName: String,
      image: String,
    },
  },
  { timestamps: true }, // adds createdAt & updatedAt
);

const Comment =
  mongoose.models.Comment || mongoose.model("Comment", commentSchema);

module.exports = Comment;
