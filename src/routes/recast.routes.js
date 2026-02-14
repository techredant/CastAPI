const express = require("express");
const router = express.Router();
const Post = require("../models/post");

module.exports = (io) => {
  router.post("/", async (req, res) => {
    try {
      const { userId, originalPostId, quote } = req.body;

      if (!originalPostId) {
        return res.status(400).json({ message: "originalPostId is required" });
      }

      // 1️⃣ Find the original post
      let originalPost = await Post.findById(originalPostId);
      if (!originalPost) {
        return res.status(404).json({ message: "Original post not found" });
      }

      // If the original post is itself a recast/quote, follow the chain to the real original
      if (originalPost.originalPostId) {
        const parentPost = await Post.findById(originalPost.originalPostId);
        if (parentPost) originalPost = parentPost;
      }

      // 2️⃣ Create the new recast post
      const newRecast = new Post({
        userId,
        caption: originalPost.caption,
        media: originalPost.media,
        levelType: originalPost.levelType,
        levelValue: originalPost.levelValue,
        quote: quote || null,
        originalPostId: originalPost._id,
        type: "recast",
        user: originalPost.user, // optional
      });

      await newRecast.save();

      // 3️⃣ Emit new recast to socket room
      const room = `level-${originalPost.levelType}-${originalPost.levelValue}`;
      io.to(room).emit("newRecast", newRecast);

      // 4️⃣ Return new recast
      res.status(201).json(newRecast);

    } catch (err) {
      console.error("Recast error:", err);
      res.status(500).json({ message: "Failed to repost" });
    }
  });

  return router;
};
