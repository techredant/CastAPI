const { preflightText } = require("../ai/moderation/pipeline");
const { isEnabled } = require("../ai/featureFlags");

function moderationGate({ textField = "text", targetType = "content" } = {}) {
  return async (req, res, next) => {
    const text = req.body?.[textField] || req.body?.caption || "";
    const { blocked, decision } = preflightText(text);
    req.aiModerationPreflight = decision;

    if (blocked && (await isEnabled("ai_moderation_block"))) {
      return res.status(400).json({
        message: "Content blocked by AI moderation",
        targetType,
        reasons: decision.reasons,
      });
    }

    return next();
  };
}

module.exports = moderationGate;
