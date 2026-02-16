// server/routes/upsert-ai.js
const express = require("express");
const { StreamChat } = require("stream-chat");
const router = express.Router();

router.post("/", async (req, res) => {
  try {
    console.log("🌐 Upserting AI user...");

    const serverClient = StreamChat.getInstance(
      process.env.STREAM_API_KEY,
      process.env.STREAM_API_SECRET
    );

    if (!serverClient) {
      console.error("❌ Stream client not initialized");
    }

    await serverClient.upsertUser({
      id: "ai-assistant",
      name: "AI Assistant",
      image: "https://i.imgur.com/IC7Zz11.png",
      role: "user",
    });

    console.log("✅ AI user upserted");
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error recreating AI user:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});


module.exports = router;
