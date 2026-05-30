const fs = require("fs");
const path = require("path");
const { completeJson, sanitizePromptInput, tieredModel } = require("../providers/llm");

const prompt = fs.readFileSync(
  path.join(__dirname, "../prompts/moderation.judge.md"),
  "utf8",
);

const QUICK_BLOCK_PATTERNS = [
  /\b(kill|murder|burn|attack)\s+(them|him|her|those|all)\b/i,
  /\b(vote\s+twice|fake\s+results|rig\s+the\s+vote)\b/i,
];

const QUICK_QUEUE_PATTERNS = [
  /\b(tribe|kabila|madoadoa|outsider|enemy)\b/i,
  /\b(corrupt|stole|thief|cartel)\b/i,
];

function quickScan(text) {
  const value = String(text || "");
  if (!value.trim()) return { severity: 0, action: "allow", labels: {}, reasons: [] };
  if (QUICK_BLOCK_PATTERNS.some((pattern) => pattern.test(value))) {
    return {
      severity: 0.85,
      action: "block",
      labels: { incitement_violence: 0.85 },
      reasons: ["Potential violent or election-manipulation language"],
    };
  }
  if (QUICK_QUEUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return {
      severity: 0.4,
      action: "queue",
      labels: { toxicity: 0.4 },
      reasons: ["Potentially sensitive political or tribal language"],
    };
  }
  return { severity: 0, action: "allow", labels: {}, reasons: [] };
}

function normalizeDecision(decision) {
  const severity = Math.max(0, Math.min(1, Number(decision?.severity || 0)));
  let action = decision?.action || "allow";
  if (!["allow", "shadow", "block", "queue"].includes(action)) {
    if (severity >= 0.8) action = "block";
    else if (severity >= 0.5) action = "shadow";
    else if (severity >= 0.3) action = "queue";
    else action = "allow";
  }
  return {
    severity,
    action,
    labels: decision?.labels || {},
    reasons: Array.isArray(decision?.reasons) ? decision.reasons : [],
    language: decision?.language || "unknown",
  };
}

async function classifyText({ text, userId, targetType, targetId }) {
  const quick = quickScan(text);
  if (quick.severity >= 0.8 || !process.env.OPEN_ROUTER_API_KEY) {
    return normalizeDecision(quick);
  }

  const result = await completeJson({
    model: tieredModel("fast"),
    feature: "moderation",
    userId,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify({
          targetType,
          targetId,
          text: sanitizePromptInput(text),
          quickScan: quick,
        }),
      },
    ],
    temperature: 0,
  });

  if (!result.json) return normalizeDecision(quick);
  return normalizeDecision(result.json);
}

module.exports = {
  classifyText,
  quickScan,
};
