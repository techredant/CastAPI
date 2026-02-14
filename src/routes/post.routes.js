const express = require("express");
const Post = require("../models/post");
const User = require("../models/user");

module.exports = (io) => {
  const router = express.Router();

  const getRoomName = (levelType, levelValue) =>
    `level-${levelType}-${levelValue || "all"}`;

  // ✅ Get posts
  const kenyaData = require("../assets/iebc.json"); // adjust path if needed

    // ✅ Create post
  router.post("/", async (req, res) => {
    try {
      const { userId, caption, media, quote, originalPostId, levelType, levelValue, type } = req.body;
      if (!userId) return res.status(400).json({ message: "userId is required" });

      const user = await User.findOne({ clerkId: userId });
      if (!user) return res.status(404).json({ message: "User not found" });

      let originalPost = null;
      if (originalPostId) {
        originalPost = await Post.findById(originalPostId);
        if (!originalPost) return res.status(404).json({ message: "Original post not found" });
      }

      const newPost = new Post({
        userId,
        caption: caption || (originalPost?.caption || ""),
        media: media || (originalPost?.media || []),
        reciteMedia: originalPost?.media || [],
        levelType: originalPost?.levelType || levelType,
        levelValue: originalPost?.levelValue || levelValue,
        quote: quote || (originalPost?.quote || null),
        originalPostId: originalPostId || null,
        type: type || "post",
        user: {
          clerkId: user.clerkId,
          firstName: user.firstName,
          lastName: user.lastName,
          nickName: user.nickName,
          image: user.image,
        },
        reciteFirstName: originalPost?.user?.firstName || "",
        reciteLastName: originalPost?.user?.lastName || "",
        reciteNickName: originalPost?.user?.nickName || "",
        reciteImage: originalPost?.user?.image || "",

        recastCount: 0,
        reciteCount: 0
      });

      await newPost.save();

      const room = getRoomName(newPost.levelType, newPost.levelValue);
      io.to(room).emit("newPost", newPost);

      return res.status(201).json(newPost);

    } catch (err) {
      console.error("❌ Error creating post:", err);
      return res.status(500).json({ message: "Server error" });
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


router.get("/:id", async (req, res) => {
  try {
    const { levelType, levelValue } = req.query;
    const { id } = req.params; // this is the clerkId from frontend

    // Base filter: include only posts not deleted
    const filter = {
      authorId: id,
      $or: [
        { isDeleted: { $exists: false } },
        { isDeleted: false },
      ],
    };

    // DEBUG logs
    const totalPosts = await Post.countDocuments({ authorId: id });
    console.log(`🟢 Total posts in DB for clerkId ${id}:`, totalPosts);

    if (levelType === "home") {
      const posts = await Post.find(filter).sort({ createdAt: -1 });
      console.log(`🟢 Posts returned for HOME:`, posts.length);
      return res.status(200).json(posts);
    }

    // --- hierarchy logic for county/constituency/ward ---
    const getRelatedLevels = (levelType, levelValue) => {
      if (levelType === "county") {
        const county = kenyaData.counties.find(c => c.name === levelValue);
        if (!county) return [];
        return [
          county.name,
          ...county.constituencies.map(c => c.name),
          ...county.constituencies.flatMap(c => c.wards.map(w => w.name)),
        ];
      }

      if (levelType === "constituency") {
        const constituency = kenyaData.counties
          .flatMap(c => c.constituencies)
          .find(cs => cs.name === levelValue);
        if (!constituency) return [];
        return [constituency.name, ...constituency.wards.map(w => w.name)];
      }

      if (levelType === "ward") return [levelValue];

      return [];
    };

    const relatedLevels = getRelatedLevels(levelType, levelValue);

    const posts = await Post.find({
      ...filter,
      levelValue: { $in: relatedLevels },
      levelType: { $ne: "home" },
    }).sort({ createdAt: -1 });

    console.log(`🟢 Posts returned for ${levelType}:`, posts.length);

    res.status(200).json(posts);
  } catch (err) {
    console.error("❌ Error fetching posts:", err);
    res.status(500).json({ message: "Server error" });
  }
});



  // ✅ Like / Unlike
  router.post("/:id/like", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "Missing userId" });

      const post = await Post.findById(req.params.id);
      if (!post) return res.status(404).json({ message: "Post not found" });

      const alreadyLiked = post.likes.includes(userId);
      if (alreadyLiked) {
        post.likes = post.likes.filter((id) => id !== userId);
      } else {
        post.likes.push(userId);
      }

      await post.save();
      io.to(getRoomName(post.levelType, post.levelValue)).emit(
        "updatePost",
        post
      );

      res.status(200).json(post);
    } catch (err) {
      console.error("❌ Error liking post:", err);
      res.status(500).json({ message: "Server error" });
    }
  });



//   // ✅ Increment views
router.post("/:id/view", async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: "Failed to increment views" });
  }
});

// recastCount
router.post("/:id/recastCount", async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $inc: { recastCount: 1 } },
      { new: true }
    );
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: "Failed to increment views" });
  }
});
// reciteCount
router.post("/:id/reciteCount", async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $inc: { reciteCount: 1 } },
      { new: true }
    );
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: "Failed to increment views" });
  }
});

//   // ✅ Delete post (with ownership check)
router.delete("/:id", async (req, res) => {
  try {
    const { userId } = req.body;
    const post = await Post.findById(req.params.id);

    if (!post) return res.status(404).json({ message: "Post not found" });

    if (post.userId !== userId) {
      return res
        .status(403)
        .json({ message: "Unauthorized to delete this post" });
    }

    post.isDeleted = true;
    await post.save();

    io.to(getRoomName(post.levelType, post.levelValue)).emit(
      "deletePost",
      post._id
    );

    res.status(200).json({ message: "Post hidden", postId: req.params.id });
  } catch (err) {
    console.error("❌ Error deleting post:", err);
    res.status(500).json({ message: "Server error" });
  }
});

  // router.put("/restore/:id", async (req, res) => {
  //   try {
  //     const post = await Post.findByIdAndUpdate(
  //       req.params.id,
  //       { isDeleted: false },
  //       { new: true }
  //     );
  //     res.json(post);
  //   } catch (err) {
  //     res.status(500).json({ message: err.message });
  //   }
  // });

//   // POST /posts/:id/recast
//   // ✅ Clean single Recast Route
  router.post("/:id/recast", async (req, res) => {
    try {
      console.log("📩 Recast request body:", req.body);
      console.log("📩 Recast request params:", req.params);

      const { id } = req.params;
      const { userId, nickname } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const post = await Post.findById(id);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      // Ensure recasts array exists
      if (!Array.isArray(post.recasts)) post.recasts = [];

      // Find existing recast by same user (only matters for toggle)
          const existingIndex = post.recasts.findIndex(
          (r) => r.userId === userId && !r.quote
        );


if (existingIndex >= 0) {
  post.recasts.splice(existingIndex, 1); // toggle off
} else {
  post.recasts.push({
    userId,
    nickname: nickname || "Anonymous",
    recastedAt: new Date(),
  });
}

      await post.save();

      // Emit socket update so others see immediately
      io.to(getRoomName(post.levelType, post.levelValue)).emit(
        "updatePost",
        post
      );

      console.log("✅ Recast processed successfully");
      return res.status(200).json(post);
    } catch (error) {
      console.error("🔥 SERVER ERROR during recast:", error);
      return res
        .status(500)
        .json({ message: "Server error", error: error.message });
    }
  });

  // ✅ New simplified recite route (recast with optional quote)
router.post("/:id/recite", async (req, res) => {
  try {
    const { userId, quoteText, nickname } = req.body;
    const { id } = req.params;

    if (!userId) return res.status(400).json({ message: "userId is required" });

    const post = await Post.findById(id);
    if (!post) return res.status(404).json({ message: "Post not found" });

    // ✅ Ensure recasts array exists
    if (!Array.isArray(post.recites)) post.recites = [];

    // Check if already recasted by this user (toggle if no quote)
    const existingIndex = post.recites.findIndex(
      (r) => r.userId === userId && !r.quote
    );

    if (existingIndex >= 0 && !quoteText) {
      post.recites.splice(existingIndex, 1);
    } else {
      post.recites.push({
        userId,
        nickname: nickname || "Anonymous",
        quote: quoteText || "",
        recastedAt: new Date(),
      });
    }

    await post.save();

    const io = req.app.get("io");
    io.emit("postUpdated", post);

    res.status(200).json(post);
  } catch (err) {
  console.error("🔥 /recite error:", err);
  console.error(err.stack); // very useful
  res.status(500).json({ message: "Error reciting post", error: err.message });
}

});



  return router;
};
