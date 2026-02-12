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
      originalPostId,
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


    const room = getRoomName(levelType, levelValue);
    io.to(room).emit("newRecite", newPost);

    res.status(201).json(newPost);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


router.get("/", async (req, res) => {
  try {
    const { levelType, levelValue } = req.query;

    // ✅ Include posts that are not deleted
    const filter = { $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }] };

    const getRelatedLevels = (levelType, levelValue) => {
      switch (levelType) {
        case "home":
          // Home: show only county-level posts
          return {
            levelTypes: ["home", "county"],
            levelValues: null, // null means all counties
          };

        case "county":
          // County: show county + constituencies
          const county = kenyaData.counties.find((c) => c.name === levelValue);
          if (!county) return { levelTypes: [], levelValues: [] };
          const constituencyNames = county.constituencies.map((c) => c.name);
          return {
            levelTypes: ["county", "constituency"],
            levelValues: [county.name, ...constituencyNames],
          };

        case "constituency":
          // Constituency: show constituency + wards
          const constituency = kenyaData.counties
            .flatMap((c) => c.constituencies)
            .find((cs) => cs.name === levelValue);
          if (!constituency) return { levelTypes: [], levelValues: [] };
          const wardNames = constituency.wards.map((w) => w.name);
          return {
            levelTypes: ["constituency", "ward"],
            levelValues: [constituency.name, ...wardNames],
          };

        case "ward":
          return { levelTypes: ["ward"], levelValues: [levelValue] };

        default:
          return { levelTypes: [], levelValues: [] };
      }
    };

    const { levelTypes, levelValues } = getRelatedLevels(levelType, levelValue);

    // Build query dynamically
    const query = {
      ...filter,
      levelType: { $in: levelTypes },
    };

    if (levelValues) {
      query.levelValue = { $in: levelValues };
    }

    const posts = await Post.find(query).sort({ createdAt: -1 });

const postsWithCounts = await Promise.all(
  posts.map(async (post) => {
    const quoteCount = await Post.countDocuments({
      originalPostId: post._id,
      quote: { $exists: true, $ne: null },
    });

    return {
      ...post.toObject(),
      quoteCount,
    };
  })
);

res.status(200).json(postsWithCounts);

  } catch (err) {
    console.error("❌ Error fetching posts:", err);
    res.status(500).json({ message: "Server error" });
  }
});

  return router;
};
