// server/routes/upsert-ai.js
const express = require("express");
const { StreamChat } = require("stream-chat");
const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const serverClient = StreamChat.getInstance(
      process.env.STREAM_API_KEY,
      process.env.STREAM_API_SECRET
    );

    // Upsert AI user — recreate if deleted
    await serverClient.upsertUser({
      id: "ai-assistant",
      name: "AI Assistant",
      image: "https://i.imgur.com/IC7Zz11.png",
      role: "user",
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error recreating AI user:", err);
    res.status(500).json({ error: "Failed to recreate AI user" });
  }
});

module.exports = router;
