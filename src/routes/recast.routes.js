const express = require("express");
const router = express.Router();
const Post = require("../models/post");
const Recite = require("../models/recite"); // if you want to handle recites too

// Repost a post (recast)
module.exports = (io) => {
  router.post("/", async (req, res) => {
    try {
      const {
        userId,          // the user who is recasting
        originalPostId,  // ID of the post or recite being recast
        quote,           // optional text
        type,            // "post" or "recite"
      } = req.body;

      // Fetch the original post or recite
      let original;
      if (type === "recite") {
        original = await Recite.findById(originalPostId);
      } else {
        original = await Post.findById(originalPostId);
      }

      if (!original)
        return res.status(404).json({ message: "Original post not found" });

      // Build the recast
      const newRecast = new Post({
        userId,
        caption: original.caption,
        media: original.media || [],
        reciteMedia: original.reciteMedia || [],
        levelType: original.levelType,
        levelValue: original.levelValue,
        quote: quote || "",
        originalPostId: original._id,
        reciteFirstName: original.user?.firstName || "",
        reciteLastName: original.user?.lastName || "",
        reciteNickName: original.user?.nickName || "Anonymous",
        reciteImage: original.user?.image || "",
        user: {
          clerkId: userId,
          firstName: req.body.firstName || "",
          lastName: req.body.lastName || "",
          nickName: req.body.nickName || "Anonymous",
          image: req.body.image || "",
        },
      });

      // Increment recast count on the original post
      await Post.findByIdAndUpdate(originalPostId, { $inc: { recastCount: 1 } });

      // Save the new recast
      await newRecast.save();

      // Emit via socket
      const room = `level-${original.levelType}-${original.levelValue}`;
      io.to(room).emit("newRecast", newRecast);

      return res.status(201).json(newRecast);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to repost" });
    }
  });

  return router;
};
