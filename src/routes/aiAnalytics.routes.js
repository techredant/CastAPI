const express = require("express");
const AiAuditLog = require("../models/aiAuditLog");
const { loadFlags, setFlag } = require("../ai/featureFlags");

const router = express.Router();

router.get("/cost", async (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 60);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await AiAuditLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: {
          feature: "$feature",
          model: "$model",
          day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        },
        calls: { $sum: 1 },
        tokens: { $sum: "$totalTokens" },
        costUsd: { $sum: "$costUsd" },
        avgLatencyMs: { $avg: "$latencyMs" },
      },
    },
    { $sort: { "_id.day": 1, "_id.feature": 1 } },
  ]);
  res.json({ rows });
});

router.get("/flags", async (_req, res) => {
  res.json({ flags: await loadFlags() });
});

router.post("/flags", async (req, res) => {
  const { key, enabled, description, updatedBy } = req.body || {};
  if (!key) return res.status(400).json({ message: "key is required" });
  const flag = await setFlag({ key, enabled: Boolean(enabled), description, updatedBy });
  res.json({ flag, flags: await loadFlags() });
});

module.exports = router;
