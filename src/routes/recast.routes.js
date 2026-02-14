const express = require("express");
const router = express.Router();
const Post = require("../models/post");

module.exports = (io) => {
  router.post("/", async (req, res) => {
    try {
      const { userId, originalPostId, quote } = req.body;

      if (!userId || !originalPostId) {
        return res.status(400).json({ message: "userId and originalPostId are required" });
      }

      // 1️⃣ Find the original post (root of the thread)
      const originalPost = await Post.findById(originalPostId);
      if (!originalPost) {
        return res.status(404).json({ message: "Original post not found" });
      }

      // 2️⃣ Build the recast post
      const newRecast = new Post({
        userId,                       // The user who recasts
        caption: originalPost.caption,
        media: originalPost.media,
        levelType: originalPost.levelType,
        levelValue: originalPost.levelValue,
        quote: quote || originalPost.quote || null,  // Keep quote if provided, fallback to original
        originalPostId: originalPost.originalPostId || originalPost._id, // always link to root
        type: "recast",
        user: originalPost.user,       // info of original creator
      });

      // 3️⃣ Save to DB
      await newRecast.save();

      // 4️⃣ Emit to correct level room via socket
      const room = `level-${originalPost.levelType}-${originalPost.levelValue}`;
      io.to(room).emit("newRecast", newRecast);

      // 5️⃣ Return the new recast
      res.status(201).json(newRecast);

    } catch (err) {
      console.error("Recast error:", err);
      res.status(500).json({ message: "Failed to repost" });
    }
  });

  return router;
};
