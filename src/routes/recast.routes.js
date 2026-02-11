const express = require("express");
const router = express.Router();
const Post = require("../models/Post");

// Repost a post
router.post("/", async (req, res) => {
  try {
    const { userId, originalPostId, quote } = req.body;

    const originalPost = await Post.findById(originalPostId);
    if (!originalPost) return res.status(404).json({ message: "Original post not found" });

    const newRecite = new Post({
      userId,
      caption: originalPost.caption,
      media: originalPost.media,
      reciteMedia: originalPost.media, // copy media
      levelType: originalPost.levelType,
      levelValue: originalPost.levelValue,
      quote,
      originalPostId: originalPost._id,

      reciteFirstName: originalPost.user.firstName,
      reciteLastName: originalPost.user.lastName,
      reciteNickName: originalPost.user.nickName,
      reciteImage: originalPost.user.image,

      user: {
        clerkId: originalPost.user.clerkId,
        firstName: originalPost.user.firstName,
        lastName: originalPost.user.lastName,
        nickName: originalPost.user.nickName,
        image: originalPost.user.image,
      },
    });

    await newRecite.save();

    // increment original post quoteCount
    originalPost.quoteCount = (originalPost.quoteCount || 0) + 1;
    await originalPost.save();

    res.status(201).json(newRecite);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to repost" });
  }
});

module.exports = router;
