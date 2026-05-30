const express = require("express");
const Post = require("../models/post");
const InteractionLog = require("../models/interactionLog");
const UserInterestVector = require("../models/userInterestVector");
const { isEnabled } = require("../ai/featureFlags");
const { buildFeatures, getCandidates, getUserContext } = require("../ai/ranking/features");
const { scorePost } = require("../ai/ranking/score");
const { diversifyRankedPosts } = require("../ai/ranking/exploreExploit");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    if (!(await isEnabled("ai_feed"))) {
      return res.status(503).json({ message: "AI feed is disabled" });
    }

    const userId = String(req.query.userId || req.query.viewerId || "");
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const { user, interests } = await getUserContext(userId);
    const candidates = await getCandidates({
      userId,
      levelType: req.query.levelType,
      levelValue: req.query.levelValue,
      limit: 220,
    });
    const ranked = diversifyRankedPosts(
      candidates
        .map((post) => {
          const features = buildFeatures({ post, user, interests });
          return { post, features, score: scorePost(features) };
        })
        .sort((a, b) => b.score - a.score),
    ).slice(0, limit);

    return res.json({
      posts: ranked.map((item) => ({
        ...item.post,
        aiRankScore: item.score,
        aiRankFeatures: item.features,
      })),
    });
  } catch (error) {
    console.error("AI feed failed:", error);
    return res.status(500).json({ message: "AI feed failed" });
  }
});

router.post("/signal", async (req, res) => {
  try {
    const { userId, postId, action = "view", dwellMs = 0, county, topics = [] } = req.body || {};
    if (!userId || !postId) {
      return res.status(400).json({ message: "userId and postId are required" });
    }

    await InteractionLog.create({
      userId,
      postId,
      action,
      dwellMs,
      county,
      topics,
      value: action === "dwell" ? Math.min(Number(dwellMs) / 1000, 60) : 1,
    });

    if (action === "like" || action === "dwell" || action === "comment") {
      const topicWeights = topics.map((topic) => ({ topic, weight: 1 }));
      await UserInterestVector.findOneAndUpdate(
        { userId },
        {
          $set: { lastBuiltAt: new Date() },
          $addToSet: { topTopics: { $each: topicWeights } },
        },
        { upsert: true },
      );
      req.app.get("io")?.to(userId).emit("feed:rankUpdated", { userId });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("AI feed signal failed:", error);
    return res.status(500).json({ message: "AI feed signal failed" });
  }
});

router.post("/rebuild-interest/:userId", async (req, res) => {
  try {
    const logs = await InteractionLog.find({ userId: req.params.userId })
      .sort({ ts: -1 })
      .limit(1000)
      .lean();
    const postIds = logs.map((log) => log.postId).filter(Boolean);
    const posts = await Post.find({ _id: { $in: postIds } }).select("aiTopics levelValue").lean();
    const topicCounts = new Map();
    const countyCounts = new Map();

    for (const post of posts) {
      for (const topic of post.aiTopics || []) {
        topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      }
      if (post.levelValue) {
        countyCounts.set(post.levelValue, (countyCounts.get(post.levelValue) || 0) + 1);
      }
    }

    const topTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([topic, weight]) => ({ topic, weight }));
    const counties = [...countyCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([county, weight]) => ({ county, weight }));

    const doc = await UserInterestVector.findOneAndUpdate(
      { userId: req.params.userId },
      { $set: { topTopics, counties, lastBuiltAt: new Date() } },
      { upsert: true, new: true },
    );
    return res.json({ ok: true, interests: doc });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not rebuild interests" });
  }
});

module.exports = router;
