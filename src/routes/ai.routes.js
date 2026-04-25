const express = require("express");

const router = express.Router();

router.post("/start-ai-agent", async (req, res) => {
  const { channel_id, channel_type = "messaging", platform, model } = req.body;

  if (!channel_id) {
    return res.status(400).json({ error: "Missing channel_id" });
  }

  const channelId = normalizeChannelId(channel_id);
  if (!channelId) {
    return res.status(400).json({ error: "Invalid channel_id" });
  }

  try {
    await agentManager.startAgent({
      userId: buildAgentUserId(channelId),
      channelId,
      channelType: channel_type,
      platform,
      model,
    });

    return res.json({ message: "AI Agent started" });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to start AI Agent",
      reason: error?.message || "Unknown error",
    });
  }
});

router.post("/stop-ai-agent", async (req, res) => {
  const channelId = normalizeChannelId(req.body?.channel_id || "");

  if (!channelId) {
    return res.status(400).json({ error: "Invalid channel_id" });
  }

  try {
    await agentManager.stopAgent(buildAgentUserId(channelId));
    return res.json({ message: "AI Agent stopped" });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to stop AI Agent",
      reason: error?.message || "Unknown error",
    });
  }
});

router.post("/register-tools", (req, res) => {
  const { channel_id, tools } = req.body || {};

  if (typeof channel_id !== "string" || !channel_id.trim()) {
    return res.status(400).json({ error: "Missing or invalid channel_id" });
  }

  if (!Array.isArray(tools)) {
    return res.status(400).json({ error: "Missing or invalid tools array" });
  }

  const channelId = normalizeChannelId(channel_id);

  agentManager.registerClientTools(channelId, tools);

  return res.json({
    message: "Client tools registered",
    count: tools.length,
  });
});

module.exports = router;
