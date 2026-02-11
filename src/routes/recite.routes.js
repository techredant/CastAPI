const express = require("express");
const Recite = require("../models/recite"); // Recite schema
const Post = require("../models/post");     // Original posts
const User = require("../models/user");

module.exports = (io) => {
  const router = express.Router();

  const getRoomName = (levelType, levelValue) =>
    `level-${levelType}-${levelValue || "all"}`;

  const kenyaData = require("../assets/iebc.json"); // for levels if needed

  // -----------------------
  // CREATE RECITE
  // -----------------------
  router.post("/", async (req, res) => {
    try {
      const { userId, quote, caption, type, originalPostId, linkPreview, reciteFirstName, reciteLastName, reciteNickName, reciteImage, reciteMedia } = req.body;

      if (!originalPostId) {
        return res.status(400).json({ message: "originalPostId is required" });
      }

      // 1️⃣ Get user
      const user = await User.findOne({ clerkId: userId });
      if (!user) return res.status(404).json({ message: "User not found" });

      // 2️⃣ Get original post (to inherit level info)
      const originalPost = await Post.findById(originalPostId);
      if (!originalPost) return res.status(404).json({ message: "Original post not found" });

      // 3️⃣ Create recite
      const newRecite = new Recite({
        userId,
        reciteFirstName,
        reciteLastName,
        reciteNickName,
        reciteImage,
        caption,
        reciteMedia,
        quote,
        type: type || "recite",
        originalPostId,
        linkPreview: linkPreview || null,
        levelType: originalPost.levelType,
        levelValue: originalPost.levelValue,
        user: {
          clerkId: user.clerkId,
          firstName: user.firstName,
          lastName: user.lastName,
          nickName: user.nickName,
          image: user.image,
        },
      });

      await newRecite.save();

      // 4️⃣ Emit to the room based on level
      const room = getRoomName(originalPost.levelType, originalPost.levelValue);
      io.to(room).emit("newRecite", newRecite);

      res.status(201).json(newRecite);
    } catch (err) {
      console.error("❌ Error creating recite:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // -----------------------
  // GET RECITES
  // -----------------------
  router.get("/", async (req, res) => {
    try {
      const { levelType, levelValue } = req.query;

      // Include non-deleted recites
      const filter = { $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }] };

      // Build query based on levels
      const query = { ...filter };
      if (levelType) query.levelType = levelType;
      if (levelValue) query.levelValue = levelValue;

      const recites = await Recite.find(query).sort({ createdAt: -1 });

      // Count how many times each original post has been recited
      const recitesWithCounts = await Promise.all(
        recites.map(async (recite) => {
          const quoteCount = await Recite.countDocuments({
            originalPostId: recite.originalPostId,
            quote: { $exists: true, $ne: null },
          });

          return {
            ...recite.toObject(),
            quoteCount,
          };
        })
      );

      res.status(200).json(recitesWithCounts);
    } catch (err) {
      console.error("❌ Error fetching recites:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
