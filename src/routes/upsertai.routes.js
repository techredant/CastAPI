// server/routes/upsert-ai-channel.js
const express = require("express");
const { StreamChat } = require("stream-chat");
const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    // 1️⃣ Initialize Stream server client
    const serverClient = StreamChat.getInstance(
      process.env.STREAM_API_KEY,
      process.env.STREAM_API_SECRET
    );

    // 2️⃣ Upsert AI user (recreates if deleted)
    await serverClient.upsertUser({
      id: "ai-broadcastke",
      name: "AI Assistant",
      image: "https://i.imgur.com/IC7Zz11.png",
      role: "user",
    });

    // 3️⃣ Create or get AI channel with current user + AI
    const aiChannel = serverClient.channel("messaging", `ai-chat-${userId}`, {
      members: [userId, "ai-assistant"],
    });

    // 4️⃣ Watch the channel so it exists
    await aiChannel.watch();

    // 5️⃣ Return channel data
    return res.json({
      success: true,
      channel: {
        id: aiChannel.id,
        cid: aiChannel.cid,
        members: aiChannel.state.members,
      },
    });
  } catch (err) {
    console.error("❌ Failed to upsert AI + channel:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
