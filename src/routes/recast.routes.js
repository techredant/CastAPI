const express = require("express");
const router = express.Router();
const Post = require("../models/post");

// Recast route
module.exports = (io) => {
  router.post("/", async (req, res) => {
    try {
      const { userId, originalPostId, quote } = req.body;

      // 1️⃣ Find the original post
      const originalPost = await Post.findById(originalPostId);
      if (!originalPost) {
        return res.status(404).json({ message: "Original post not found" });
      }

      // 2️⃣ Create the new recast post
      const newRecast = new Post({
        userId,                     // user who recasts
        caption: originalPost.caption,
        media: originalPost.media,
        levelType: originalPost.levelType,
        levelValue: originalPost.levelValue,
        quote: quote || null,
        originalPostId: originalPost._id, // LINK to original
        type: "recast",
        user: originalPost.user,          // optional: can remove if you fetch later via ref
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
