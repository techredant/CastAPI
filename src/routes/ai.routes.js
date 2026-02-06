// routes/ai.routes.js
const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

router.post("/", async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) return res.status(400).json({ ok: false, error: "Missing user_id" });

  try {
    // 1️⃣ Upsert AI user
    await streamClient.upsertUser({
      id: "ai-assistant",
      name: "AI Assistant",
      role: "admin",
    });

    // 2️⃣ Upsert current user
    await streamClient.upsertUser({ id: user_id });

    // 3️⃣ Get or create channel
    const channelId = `ai-chat-${user_id}`;
    const channel = streamClient.channel("messaging", channelId, {
      members: [user_id, "ai-assistant"],
    });

    await channel.watch(); // safe: creates if not exists

    return res.status(200).json({ ok: true, channel_id: channelId });
  } catch (err) {
    console.error("AI channel creation failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to create AI channel" });
  }
});

module.exports = router;
