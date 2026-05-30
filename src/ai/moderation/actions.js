const Post = require("../../models/post");
const Comment = require("../../models/comment");
const ModerationCase = require("../../models/moderationCase");
const { isEnabled } = require("../featureFlags");

async function upsertCase({ targetType, targetId, authorId, text, decision }) {
  return ModerationCase.findOneAndUpdate(
    { targetType, targetId },
    {
      $set: {
        authorId,
        text,
        reasons: decision.reasons || [],
        labels: decision.labels || {},
        severity: decision.severity || 0,
        action: decision.action || "allow",
        judge: "ai",
        status: decision.action === "allow" ? "resolved" : "open",
      },
    },
    { upsert: true, new: true },
  );
}

async function applyAction({ targetType, targetId, decision }) {
  const blockEnabled = await isEnabled("ai_moderation_block");
  const action = decision.action || "allow";
  const update = {
    aiRiskScore: decision.severity || 0,
    aiModerationAction: action,
    aiSensitive: (decision.severity || 0) >= 0.5,
  };

  if (targetType === "post") {
    if (action === "block" && blockEnabled) update.isDeleted = true;
    await Post.findByIdAndUpdate(targetId, update);
  }

  if (targetType === "comment") {
    const commentUpdate = {
      aiToxicity: decision.labels?.toxicity || decision.severity || 0,
      aiRiskScore: decision.severity || 0,
      aiAction: action,
      aiLabels: decision.labels || {},
    };
    await Comment.findByIdAndUpdate(targetId, commentUpdate);
  }
}

async function recordDecision(payload) {
  const moderationCase = await upsertCase(payload);
  await applyAction(payload);
  return moderationCase;
}

module.exports = {
  applyAction,
  recordDecision,
  upsertCase,
};
