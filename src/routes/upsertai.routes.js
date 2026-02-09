const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

// ================= CREATE AI ASSISTANT USER =================
// POST /api/createAiUser
router.post("/", async (req, res) => {
  try {
    const serverClient = StreamChat.getInstance(
        process.env.STREAM_API_KEY,
        process.env.STREAM_API_SECRET
    );

    await serverClient.upsertUser({
      id: "ai-assistant",
      name: "AI Assistant",
      image: "https://i.imgur.com/IC7Zz11.png",
      role: "user",
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error creating AI user:", err);
    res.status(500).json({ error: "Failed to create AI assistant user" });
  }
});

module.exports = router;