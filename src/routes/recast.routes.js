const express = require("express");
const router = express.Router();
const Post = require("../models/post");

// Repost a post
module.exports = (io) => {
  router.post("/", async (req, res) => {
    try {
      const { userId, originalPostId, quote } = req.body;

      const originalPost = await Post.findById(originalPostId);
      if (!originalPost)
        return res.status(404).json({ message: "Original post not found" });

      const newRecast = new Post({
        userId,
        caption: originalPost.caption,
        media: originalPost.media,
        levelType: originalPost.levelType,
        levelValue: originalPost.levelValue,
        quote,
        originalPostId: originalPost._id,
        type: "recast",
        user: originalPost.user,
      });

 await Post.findByIdAndUpdate(originalPostId, { $inc: { recastCount: 1 } });
      
      await newRecast.save();
      

      const room = `level-${originalPost.levelType}-${originalPost.levelValue}`;
      io.to(room).emit("newRecast", newRecast);

      res.status(201).json(newRecast);

    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to repost" });
    }
  });

  return router;
};
