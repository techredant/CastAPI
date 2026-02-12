const express = require("express");
const Recite = require("../models/recite");
const Post = require("../models/post");
const User = require("../models/user");

module.exports = (io) => {
  const router = express.Router();

  const getRoomName = (levelType, levelValue) =>
    `level-${levelType}-${levelValue || "all"}`;

  // =========================
  // CREATE RECITE
  // =========================
  router.post("/", async (req, res) => {
    try {
      const {
        userId,
        quote,
        caption,
        originalPostId,
        linkPreview,
      } = req.body;

      if (!originalPostId) {
        return res.status(400).json({
          message: "originalPostId is required",
        });
      }

      // Find user
      const user = await User.findOne({ clerkId: userId });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Find original post
      const originalPost = await Post.findById(originalPostId);
      if (!originalPost) {
        return res.status(404).json({
          message: "Original post not found",
        });
      }

      // Prevent duplicate recites
      const existing = await Recite.findOne({
        userId,
        originalPostId,
      });

      if (existing) {
        return res.status(400).json({
          message: "You already recited this post",
        });
      }

      // Create recite
      const newRecite = new Recite({
        userId,
        caption,
        quote: quote || null,
        originalPostId,
        linkPreview: linkPreview || null,

        // Inherit level from original post
        levelType: originalPost.levelType,
        levelValue: originalPost.levelValue,

        // Save recited post info
        reciteMedia: originalPost.media,

        // Save original post creator info
        reciteFirstName: originalPost.user.firstName,
        reciteLastName: originalPost.user.lastName,
        reciteNickName: originalPost.user.nickName,
        reciteImage: originalPost.user.image,

        // Current user info
        user: {
          clerkId: user.clerkId,
          firstName: user.firstName,
          lastName: user.lastName,
          nickName: user.nickName,
          image: user.image,
        },
      });

     await Post.findByIdAndUpdate(originalPostId, { $inc: { reciteCount: 1 } });
      await newRecite.save();

      // Emit to correct level room
      const room = getRoomName(
        originalPost.levelType,
        originalPost.levelValue
      );

      io.to(room).emit("newRoom", newRecite);

      return res.status(201).json(newRecite);

    } catch (err) {
      console.error("❌ Error creating recite:", err);
      return res.status(500).json({
        message: "Server error",
      });
    }
  });

  // =========================
  // GET RECITES
  // =========================
  router.get("/", async (req, res) => {
    try {
      const { levelType, levelValue } = req.query;

      const filter = {
        $or: [
          { isDeleted: { $exists: false } },
          { isDeleted: false },
        ],
      };

      if (levelType) filter.levelType = levelType;
      if (levelValue) filter.levelValue = levelValue;

      const recites = await Recite.find(filter)
        .sort({ createdAt: -1 });

      // Aggregate counts in ONE query
      const counts = await Recite.aggregate([
        {
          $match: {
            originalPostId: {
              $in: recites.map(r => r.originalPostId),
            },
          },
        },
        {
          $group: {
            _id: "$originalPostId",
            count: { $sum: 1 },
          },
        },
      ]);

      const countMap = {};
      counts.forEach(c => {
        countMap[c._id.toString()] = c.count;
      });

      const recitesWithCounts = recites.map(recite => ({
        ...recite.toObject(),
        quoteCount:
          countMap[recite.originalPostId?.toString()] || 0,
      }));

      return res.status(200).json(recitesWithCounts);

    } catch (err) {
      console.error("❌ Error fetching recites:", err);
      return res.status(500).json({
        message: "Server error",
      });
    }
  });

  return router;
};
