const Post = require("../../models/post");
const User = require("../../models/user");
const UserInterestVector = require("../../models/userInterestVector");

function recencyScore(date) {
  const ageHours = Math.max(0, (Date.now() - new Date(date).getTime()) / 36e5);
  return Math.exp(-ageHours / 36);
}

function engagementVelocity(post) {
  const engagement =
    (post.likes?.length || 0) +
    (post.commentsCount || 0) * 2 +
    (post.reciteCount || 0) * 3 +
    (post.recastCount || 0) * 3 +
    (post.views || 0) * 0.05;
  return Math.log1p(engagement);
}

async function getUserContext(userId) {
  const [user, interests] = await Promise.all([
    User.findOne({ clerkId: userId }).lean(),
    UserInterestVector.findOne({ userId }).lean(),
  ]);
  return { user, interests };
}

async function getCandidates({ userId, levelType, levelValue, limit = 200 }) {
  const { user } = await getUserContext(userId);
  const sameCounty = user?.county || levelValue;
  const following = user?.following || [];
  const query = {
    isDeleted: { $ne: true },
    aiModerationAction: { $ne: "block" },
  };

  const buckets = await Promise.all([
    Post.find({ ...query, userId: { $in: following } })
      .sort({ createdAt: -1 })
      .limit(Math.ceil(limit * 0.4))
      .lean(),
    Post.find({
      ...query,
      ...(sameCounty ? { levelValue: sameCounty } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(Math.ceil(limit * 0.35))
      .lean(),
    Post.find(query)
      .sort({ views: -1, commentsCount: -1, createdAt: -1 })
      .limit(Math.ceil(limit * 0.25))
      .lean(),
  ]);

  const byId = new Map();
  for (const post of buckets.flat()) {
    byId.set(String(post._id), post);
  }
  return [...byId.values()].slice(0, limit).filter((post) => {
    if (!levelType || levelType === "home") return true;
    return !post.levelType || post.levelType === levelType || post.levelValue === levelValue;
  });
}

function topicMatch(post, interests) {
  const weights = new Map((interests?.topTopics || []).map((item) => [item.topic, item.weight || 0]));
  return (post.aiTopics || []).reduce((sum, topic) => sum + (weights.get(topic) || 0), 0);
}

function buildFeatures({ post, user, interests }) {
  const authorAffinity = (user?.following || []).includes(post.userId) ? 1 : 0;
  const countyMatch =
    user?.county && post.levelValue && String(user.county) === String(post.levelValue) ? 1 : 0;
  return {
    recency: recencyScore(post.createdAt),
    engagement: engagementVelocity(post),
    authorAffinity,
    countyMatch,
    topicMatch: topicMatch(post, interests),
    riskPenalty: post.aiRiskScore || 0,
  };
}

module.exports = {
  buildFeatures,
  engagementVelocity,
  getCandidates,
  getUserContext,
  recencyScore,
};
