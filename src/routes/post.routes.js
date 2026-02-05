const express = require("express");
const Post = require("../models/post");
const User = require("../models/user");
const Comment = require("../models/comment"); // ✅ Make sure you have a Comment model

module.exports = (io) => {
  const router = express.Router();

  const getRoomName = (levelType, levelValue) =>
    `level-${levelType}-${levelValue || "all"}`;

  // ✅ Get posts
  const kenyaData = require("../assets/iebc.json"); // adjust path if needed

  // Helper: collect related level names
  const getRelatedLevels = (levelType, levelValue) => {
    if (levelType === "home") {
      // ✅ Return all levels (counties, constituencies, and wards)
      const counties = kenyaData.counties.map((c) => c.name);
      const constituencies = kenyaData.counties.flatMap((c) =>
        c.constituencies.map((cs) => cs.name)
      );
      const wards = kenyaData.counties.flatMap((c) =>
        c.constituencies.flatMap((cs) => cs.wards.map((w) => w.name))
      );

      return [...counties, ...constituencies, ...wards];
    }

    if (levelType === "county") {
      const county = kenyaData.counties.find((c) => c.name === levelValue);
      if (!county) return [];
      const constNames = county.constituencies.map((c) => c.name);
      const wardNames = county.constituencies.flatMap((c) =>
        c.wards.map((w) => w.name)
      );
      return [county.name, ...constNames, ...wardNames];
    }

    if (levelType === "constituency") {
      const constituency = kenyaData.counties
        .flatMap((c) => c.constituencies)
        .find((cs) => cs.name === levelValue);
      if (!constituency) return [];
      const wardNames = constituency.wards.map((w) => w.name);
      return [constituency.name, ...wardNames];
    }

    if (levelType === "ward") {
      return [levelValue];
    }

    return [];
  };

  // ✅ Get posts with smart filtering
  // router.get("/", async (req, res) => {
  //   try {
  //     const { levelType, levelValue } = req.query;

  //     const filter = { isDeleted: false };

  //     // --- Show everything when at home ---
  //     if (levelType === "home") {
  //       const posts = await Post.find(filter).sort({ createdAt: -1 });
  //       return res.status(200).json(posts);
  //     }

  //     // --- Build hierarchy filter when not home ---
  //     // const kenyaData = require("../data/kenya.json"); // your counties JSON
  //     const getRelatedLevels = (levelType, levelValue) => {
  //       if (levelType === "county") {
  //         const county = kenyaData.counties.find((c) => c.name === levelValue);
  //         if (!county) return [];
  //         const constNames = county.constituencies.map((c) => c.name);
  //         const wardNames = county.constituencies.flatMap((c) =>
  //           c.wards.map((w) => w.name)
  //         );
  //         return [county.name, ...constNames, ...wardNames];
  //       }

  //       if (levelType === "constituency") {
  //         const constituency = kenyaData.counties
  //           .flatMap((c) => c.constituencies)
  //           .find((cs) => cs.name === levelValue);
  //         if (!constituency) return [];
  //         const wardNames = constituency.wards.map((w) => w.name);
  //         return [constituency.name, ...wardNames];
  //       }

  //       if (levelType === "ward") {
  //         return [levelValue];
  //       }

  //       return [];
  //     };

  //     const relatedLevels = getRelatedLevels(levelType, levelValue);

  //     // ✅ exclude home posts
  //     const posts = await Post.find({
  //       ...filter,
  //       levelValue: { $in: relatedLevels },
  //       levelType: { $ne: "home" }, // exclude home
  //     }).sort({ createdAt: -1 });

  //     res.status(200).json(posts);
  //   } catch (err) {
  //     console.error("❌ Error fetching posts:", err);
  //     res.status(500).json({ message: "Server error" });
  //   }
  // });

  router.get("/", async (req, res) => {
    try {
      const { levelType, levelValue } = req.query;

      // ✅ Include posts with no isDeleted field or isDeleted = false
      const filter = {
        $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }],
      };

      if (levelType === "home") {
        const posts = await Post.find(filter).sort({ createdAt: -1 });
        return res.status(200).json(posts);
      }

      // --- Build hierarchy filter when not home ---
      const getRelatedLevels = (levelType, levelValue) => {
        if (levelType === "county") {
          const county = kenyaData.counties.find((c) => c.name === levelValue);
          if (!county) return [];
          const constNames = county.constituencies.map((c) => c.name);
          const wardNames = county.constituencies.flatMap((c) =>
            c.wards.map((w) => w.name)
          );
          return [county.name, ...constNames, ...wardNames];
        }

        if (levelType === "constituency") {
          const constituency = kenyaData.counties
            .flatMap((c) => c.constituencies)
            .find((cs) => cs.name === levelValue);
          if (!constituency) return [];
          const wardNames = constituency.wards.map((w) => w.name);
          return [constituency.name, ...wardNames];
        }

        if (levelType === "ward") {
          return [levelValue];
        }

        return [];
      };

      const relatedLevels = getRelatedLevels(levelType, levelValue);

      // ✅ Apply soft-delete filter + hierarchy filter
      const posts = await Post.find({
        ...filter,
        levelValue: { $in: relatedLevels },
        levelType: { $ne: "home" },
      }).sort({ createdAt: -1 });

      res.status(200).json(posts);
    } catch (err) {
      console.error("❌ Error fetching posts:", err);
      res.status(500).json({ message: "Server error" });
    }
  });


  // ✅ Create post
  router.post("/", async (req, res) => {
    try {
      const { userId, caption, media, levelType, levelValue, linkPreview } =
        req.body;

      const user = await User.findOne({ clerkId: userId });
      if (!user) return res.status(404).json({ message: "User not found" });

      const newPost = new Post({
        userId,
        caption,
        media,
        levelType,
        levelValue,
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
      io.to(room).emit("newPost", newPost);

      res.status(201).json(newPost);
    } catch (err) {
      console.error(err);
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

  // POST /posts/:id/recast
  // ✅ Clean single Recast Route
  router.post("/:id/recast", async (req, res) => {
    try {
      console.log("📩 Recast request body:", req.body);
      console.log("📩 Recast request params:", req.params);

      const { id } = req.params;
      const { userId, nickname, quoteText } = req.body;

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

      if (existingIndex >= 0 && !quoteText) {
        // ✅ Toggle OFF (remove recast)
        console.log("🔄 Removing existing recast");
        post.recasts.splice(existingIndex, 1);
      } else {
        // ✅ Add new recast
        console.log("➕ Adding new recast");
        post.recasts.push({
          userId,
          nickname: nickname || "Anonymous",
          quote: quoteText || "",
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

  // ✅ Increment views
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

  // ✅ Add comment
  router.get("/:id/comments", async (req, res) => {
    try {
      const comments = await Comment.find({ postId: req.params.id }).sort({
        createdAt: -1,
      });
      res.json(comments);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/:id/comments", async (req, res) => {
    try {
      const { userId, text } = req.body;
      const newComment = new Comment({
        postId: req.params.id,
        userId,
        text,
      });
      await newComment.save();
      res.status(201).json(newComment);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // ✅ Delete post (with ownership check)
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



  router.put("/restore/:id", async (req, res) => {
    try {
      const post = await Post.findByIdAndUpdate(
        req.params.id,
        { isDeleted: false },
        { new: true }
      );
      res.json(post);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });


  router.post("/:id/recast", async (req, res) => {
    try {
      const { userId, quoteText } = req.body;
      const { id } = req.params;

      const post = await Post.findById(id);
      if (!post) return res.status(404).json({ message: "Post not found" });

      // ✅ Check if already recasted (without quote)
      const existingIndex = post.recasts.findIndex((r) => r.userId === userId);

      if (existingIndex >= 0 && !quoteText) {
        // If already recasted, remove it (toggle behavior)
        post.recasts.splice(existingIndex, 1);
      } else {
        // Add a new recast
        post.recasts.push({ userId, quoteText: quoteText || "" });
      }

      await post.save();

      // Notify via socket.io
      const io = req.app.get("io");
      io.emit("postUpdated", post);

      res.status(200).json(post);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Error recasting post" });
    }
  });

  return router;
};
