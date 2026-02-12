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
    const { userId, caption, media, levelType, levelValue, linkPreview, quote, originalPostId } = req.body;

    const user = await User.findOne({ clerkId: userId });
    if (!user) return res.status(404).json({ message: "User not found" });

    const newPost = new Post({
      userId,
      caption,
      media,
      levelType, 
      levelValue,
      quote,
      originalPostId: originalPostId || null,
      linkPreview: linkPreview || null,
      user: {
        clerkId: user.clerkId,
        firstName: user.firstName,
        lastName: user.lastName,
        nickName: user.nickName,
        image: user.image,
      },
    });


    await newPost.save();


    await Post.findByIdAndUpdate(originalPostId, { $inc: { viewsCount: 1 } });
    const room = getRoomName(levelType, levelValue);
    io.to(room).emit("newPost", newPost);

    res.status(201).json(newPost);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
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
