const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");
const OpenAI = require("openai");

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// upsert ai

router.post("/get-ai-channel", async (req, res) => {
  const { user_id } = req.body;

  try {
    // 1️⃣ Upsert AI
    await streamClient.upsertUser({ id: "ai-assistant", name: "AI Assistant" });

    // 2️⃣ Upsert current user (optional)
    await streamClient.upsertUser({ id: user_id });

    // 3️⃣ Create/get channel
    const channelId = `ai-chat-${user_id}`;
    const channel = streamClient.channel("messaging", channelId, {
      members: [user_id, "ai-assistant"],
    });

    await channel.create();

    res.status(200).json({ ok: true, channel_id: channelId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create AI channel" });
  }
});



module.exports = router;
