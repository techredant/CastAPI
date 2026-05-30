const { classifyText, quickScan } = require("./classifyText");
const { recordDecision } = require("./actions");

async function moderateTextTarget({ targetType, targetId, authorId, text }) {
  const decision = await classifyText({
    text,
    userId: authorId,
    targetType,
    targetId,
  });
  const moderationCase = await recordDecision({
    targetType,
    targetId,
    authorId,
    text,
    decision,
  });
  return { decision, moderationCase };
}

function preflightText(text) {
  const decision = quickScan(text);
  return {
    blocked: decision.action === "block" && decision.severity >= 0.8,
    decision,
  };
}

module.exports = {
  moderateTextTarget,
  preflightText,
};
