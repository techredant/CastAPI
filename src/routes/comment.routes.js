const express = require("express");
const Comment = require("../models/comment");
const Post = require("../models/post");

const router = express.Router();

// ------------------- Create a Comment -------------------
router.post("/", async (req, res) => {
  try {
    const { postId, userId, userName, text } = req.body;

    if (!postId || !userId || !text) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newComment = await Comment.create({
      postId,
      userId,
      userName: userName || "Anonymous",
      text,
      createdAt: new Date(),
    });

    // Increment commentsCount in Post
    await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });

    res.status(201).json(newComment);
  } catch (err) {
    console.error("Error creating comment:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- Get all Comments for a Post -------------------
router.get("/:postId", async (req, res) => {
  try {
    const { postId } = req.params;
    const comments = await Comment.find({ postId }).sort({ createdAt: -1 });

    // Sort replies newest first
    comments.forEach((c) => {
      c.replies.sort((a, b) => b.createdAt - a.createdAt);
    });

    res.json(comments);
  } catch (err) {
    console.error("Error fetching comments:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- Like/Unlike a Comment -------------------
router.post("/:commentId/like", async (req, res) => {
  try {
    const { commentId } = req.params;
    const { userId } = req.body;

    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    if (comment.likes.includes(userId)) {
      comment.likes = comment.likes.filter((id) => id !== userId);
    } else {
      comment.likes.push(userId);
    }

    await comment.save();
    res.json(comment);
  } catch (err) {
    console.error("Error liking comment:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- Add a Reply -------------------
router.post("/:commentId/replies", async (req, res) => {
  try {
    const { commentId } = req.params;
    const { userId, userName, text } = req.body;

    if (!userId || !text) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    comment.replies.push({
      userId,
      userName: userName || "Anonymous",
      text,
      likes: [],
      createdAt: new Date(),
    });

    await comment.save();
    res.status(201).json(comment);
  } catch (err) {
    console.error("Error adding reply:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- Delete a Reply -------------------
router.delete("/:commentId/replies/:replyId", async (req, res) => {
  try {
    const { commentId, replyId } = req.params;

    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    comment.replies = comment.replies.filter(
      (r) => r._id.toString() !== replyId
    );

    await comment.save();
    res.json({ message: "Reply deleted" });
  } catch (err) {
    console.error("Error deleting reply:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- Like/Unlike a Reply -------------------
router.post("/:commentId/replies/:replyId/like", async (req, res) => {
  try {
    const { commentId, replyId } = req.params;
    const { userId } = req.body;

    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const reply = comment.replies.id(replyId);
    if (!reply) return res.status(404).json({ message: "Reply not found" });

    const index = reply.likes.indexOf(userId);
    if (index === -1) {
      reply.likes.push(userId);
    } else {
      reply.likes.splice(index, 1);
    }

    await comment.save();

    res.json({
      success: true,
      likes: reply.likes.length,
      liked: index === -1,
    });
  } catch (err) {
    console.error("Error liking reply:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- Delete a Comment -------------------
router.delete("/:commentId", async (req, res) => {
  try {
    const { commentId } = req.params;
    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    await Comment.findByIdAndDelete(commentId);
    await Post.findByIdAndUpdate(comment.postId, {
      $inc: { commentsCount: -1 },
    });

    res.json({ message: "Comment deleted" });
  } catch (err) {
    console.error("Error deleting comment:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/:id/views", async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    res.json({ message: "View count incremented", views: post.views });
  } catch (error) {
    console.error("Error updating views:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
