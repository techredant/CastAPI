const express = require("express");
const mongoose = require("mongoose");
const Comment = require("../models/comment");
const Post = require("../models/post");
const User = require("../models/user");
const { notify } = require("../services/notificationEngine.service");
const { getBroadcastRoomsForPost } = require("../utils/feedRooms");
const moderationGate = require("../middleware/moderationGate");
const { queues } = require("../workers/queue");

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractMentions = (text) => {
  if (!text) return [];
  const matches = text.match(/@[\w]+/g);
  return matches
    ? Array.from(new Set(matches.map((mention) => mention.toLowerCase())))
    : [];
};

const findMentionedUsers = async (text, excludeClerkId = null) => {
  const mentions = extractMentions(text);
  if (mentions.length === 0) return [];

  const mentionRegexes = mentions.map(
    (mention) => new RegExp(`^${escapeRegex(mention)}$`, "i"),
  );

  const query = {
    nickName: { $in: mentionRegexes },
    expoPushToken: { $exists: true, $ne: null },
  };

  if (excludeClerkId) {
    query.clerkId = { $ne: excludeClerkId };
  }

  return User.find(query);
};

module.exports = (io) => {
const router = express.Router();

const serializePost = (post) => {
  const raw =
    post && typeof post.toObject === "function"
      ? post.toObject({ virtuals: true })
      : { ...post };
  if (raw._id != null) raw._id = String(raw._id);
  if (raw.originalPostId != null) raw.originalPostId = String(raw.originalPostId);
  return raw;
};

const emitPostChange = (post) => {
  if (!io || !post) return;
  const payload = serializePost(post);
  const rooms = getBroadcastRoomsForPost(post.levelType, post.levelValue);
  for (const room of rooms) {
    io.to(room).emit("updatePost", payload);
    io.to(room).emit("postUpdated", payload);
  }
};

const emitCommentEvent = (post, eventName, payload) => {
  if (!io || !post) return;
  const rooms = getBroadcastRoomsForPost(post.levelType, post.levelValue);
  for (const room of rooms) {
    io.to(room).emit(eventName, payload);
  }
};

async function enrichCommentsWithLiveProfiles(comments) {
  const clerkIds = new Set();
  for (const c of comments) {
    if (c.userId) clerkIds.add(c.userId);
    for (const r of c.replies || []) {
      if (r.userId) clerkIds.add(r.userId);
    }
  }
  if (!clerkIds.size) return comments;

  const users = await User.find({ clerkId: { $in: [...clerkIds] } }).select(
    "clerkId firstName lastName nickName companyName image isVerified verificationType",
  );
  const byClerk = new Map(users.map((u) => [u.clerkId, u]));

  const applyLiveProfile = (snapshot, clerkId) => {
    const live = byClerk.get(clerkId);
    if (!live) return snapshot;
    return {
      ...(snapshot || {}),
      clerkId: live.clerkId,
      firstName: live.firstName || "",
      lastName: live.lastName || "",
      nickName: live.nickName || "",
      companyName: live.companyName || "",
      image: live.image || "",
      isVerified: !!live.isVerified,
      verificationType: live.verificationType || "",
    };
  };

  for (const c of comments) {
    if (c.userId) {
      c.user = applyLiveProfile(c.user, c.userId);
    }
    for (const r of c.replies || []) {
      if (r.userId) {
        r.user = applyLiveProfile(r.user, r.userId);
      }
    }
  }
  return comments;
}

async function enrichComment(comment) {
  if (!comment) return comment;
  await enrichCommentsWithLiveProfiles([comment]);
  return comment;
}

function userSnapshot(user) {
  return {
    clerkId: user.clerkId,
    firstName: user.firstName,
    lastName: user.lastName,
    nickName: user.nickName,
    companyName: user.companyName,
    image: user.image,
    isVerified: !!user.isVerified,
    verificationType: user.verificationType || "",
  };
}

// ------------------- Create a Comment -------------------
router.post(
  "/:id/comments",
  moderationGate({ textField: "text", targetType: "comment" }),
  async (req, res) => {
  try {
    const { userId, text, media } = req.body;
    const postId = req.params.id; // get from URL
    const user = await User.findOne({ clerkId: userId });
    const mediaList = Array.isArray(media) ? media.filter(Boolean) : [];
    if (!userId || (!String(text || "").trim() && mediaList.length === 0)) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newComment = await Comment.create({
      postId,
      userId,
      text,
      media: mediaList,
      user: userSnapshot(user),
      likes: [],
      createdAt: new Date(),
    });
    void queues.moderation.add("moderate-comment", {
      targetType: "comment",
      targetId: String(newComment._id),
      authorId: userId,
      text,
    }).catch(() => {});

    const post = await Post.findById(postId).select("userId user");
    const postAuthorId = post?.userId || post?.user?.clerkId;
    if (postAuthorId && postAuthorId !== userId) {
      const commenterName =
        [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
        user?.nickName ||
        user?.companyName ||
        "Someone";

      await notify({
        userId: postAuthorId,
        type: "comment",
        title: "New comment",
        body: `${commenterName} commented on your post`,
        actor: {
          userId,
          name: commenterName,
          image: user?.image,
        },
        entityId: postId,
        entityType: "comment",
        data: {
          screen: "post",
          postId,
          commentId: newComment._id.toString(),
          category: "social",
          url: "/(drawer)/(tabs)",
        },
        io,
        dedupeWindowMs: 120_000,
      });
    }

    const mentionedUsers = await findMentionedUsers(text, userId);
    for (const mentionedUser of mentionedUsers) {
      await notify({
        userId: mentionedUser.clerkId,
        type: "mention",
        title: "You were mentioned",
        body: `${user.nickName || user.firstName} mentioned you in a comment`,
        actor: {
          userId,
          name: user.nickName || user.firstName,
          image: user.image,
        },
        entityId: postId,
        entityType: "comment",
        data: {
          screen: "post",
          postId,
          commentId: newComment._id.toString(),
          url: "/(drawer)/(tabs)",
        },
        io,
      });
    }

    const updatedPost = await Post.findByIdAndUpdate(
      postId,
      { $inc: { commentsCount: 1 } },
      { new: true },
    );
    emitPostChange(updatedPost);
    emitCommentEvent(updatedPost, "commentAdded", {
      postId,
      comment: newComment,
    });

    res.status(201).json(newComment);
  } catch (err) {
    console.error("Error creating comment:", err.message);
    res.status(500).json({ message: "Server error" });
  }
  },
);

// ------------------- Get all Comments for a Post -------------------
router.get("/:postId", async (req, res) => {
  try {
    const { postId } = req.params;
    const { page = 1, limit = 5 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.json([]);
    }

    const skip = (page - 1) * limit;

    const comments = await Comment.find({ postId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    // Sort replies newest first
    comments.forEach((c) => {
      c.replies.sort((a, b) => b.createdAt - a.createdAt);
    });

    await enrichCommentsWithLiveProfiles(comments);
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
    await enrichComment(comment);
    const updatedPost = await Post.findById(comment.postId);
    emitPostChange(updatedPost);
    emitCommentEvent(updatedPost, "commentUpdated", {
      postId: String(comment.postId),
      comment,
    });
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

    const user = await User.findOne({ clerkId: userId });

    comment.replies.push({
      userId,
      text,
      likes: [],
      createdAt: new Date(),
      user: user
        ? userSnapshot(user)
        : {
            firstName: userName || "User",
            nickName: userName,
          },
    });

    await comment.save();
    await enrichComment(comment);
    const updatedPost = await Post.findById(comment.postId);
    emitPostChange(updatedPost);
    emitCommentEvent(updatedPost, "commentUpdated", {
      postId: String(comment.postId),
      comment,
    });
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
      (r) => r._id.toString() !== replyId,
    );

    await comment.save();
    const updatedPost = await Post.findById(comment.postId);
    emitPostChange(updatedPost);
    emitCommentEvent(updatedPost, "commentUpdated", {
      postId: String(comment.postId),
      comment,
    });
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
    await enrichComment(comment);
    const updatedPost = await Post.findById(comment.postId);
    emitPostChange(updatedPost);
    emitCommentEvent(updatedPost, "commentUpdated", {
      postId: String(comment.postId),
      comment,
    });

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

    // Find comment first
    const comment = await Comment.findById(commentId);

    if (!comment) {
      return res.status(404).json({
        message: "Comment not found",
      });
    }

    // Permanently delete comment
    await Comment.findByIdAndDelete(commentId);

    // Decrease post comment count
    const updatedPost = await Post.findByIdAndUpdate(
      comment.postId,
      { $inc: { commentsCount: -1 } },
      { new: true },
    );
    emitPostChange(updatedPost);
    emitCommentEvent(updatedPost, "commentDeleted", {
      postId: String(comment.postId),
      commentId,
    });

    res.json({
      message: "Comment permanently deleted",
    });
  } catch (err) {
    console.error("Error deleting comment:", err);

    res.status(500).json({
      message: "Server error",
    });
  }
});

router.patch("/:id/views", async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true },
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

return router;
};
