const express = require("express");
const ModerationCase = require("../models/moderationCase");
const { classifyText } = require("../ai/moderation/classifyText");
const { recordDecision, applyAction } = require("../ai/moderation/actions");

const router = express.Router();

router.get("/queue", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const cases = await ModerationCase.find({
    action: { $in: ["queue", "shadow", "block"] },
    status: req.query.status || "open",
  })
    .sort({ severity: -1, createdAt: -1 })
    .limit(limit)
    .lean();
  res.json({ cases });
});

router.post("/scan", async (req, res) => {
  try {
    const { targetType = "manual", targetId = `manual-${Date.now()}`, authorId, text } = req.body;
    if (!text) return res.status(400).json({ message: "text is required" });
    const decision = await classifyText({ text, userId: authorId, targetType, targetId });
    const moderationCase = await recordDecision({
      targetType,
      targetId,
      authorId,
      text,
      decision,
    });
    return res.json({ decision, case: moderationCase });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Moderation scan failed" });
  }
});

router.post("/decide", async (req, res) => {
  try {
    const { caseId, action, reviewerId, notes } = req.body || {};
    if (!caseId || !["allow", "shadow", "block", "queue"].includes(action)) {
      return res.status(400).json({ message: "caseId and valid action are required" });
    }
    const moderationCase = await ModerationCase.findByIdAndUpdate(
      caseId,
      {
        $set: {
          action,
          reviewerId,
          notes,
          judge: "human",
          status: "resolved",
        },
      },
      { new: true },
    );
    if (!moderationCase) return res.status(404).json({ message: "Case not found" });
    await applyAction({
      targetType: moderationCase.targetType,
      targetId: moderationCase.targetId,
      decision: {
        action,
        severity: moderationCase.severity,
        labels: moderationCase.labels,
      },
    });
    return res.json({ case: moderationCase });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Moderation decision failed" });
  }
});

module.exports = router;
