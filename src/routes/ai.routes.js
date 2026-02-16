const express = require("express");
const axios = require("axios");
const { StreamChat } = require("stream-chat");

const router = express.Router();

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run`;

const streamServer = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

// 🔥 ensure AI user exists once
streamServer.upsertUser({
  id: "ai",
  name: "AI Assistant",
  image: "https://i.pravatar.cc/150?img=12",
});

router.post("/chat", async (req, res) => {
  try {
    const { message, channelId } = req.body;

    if (!message || !channelId) {
      return res.status(400).json({ error: "message + channelId required" });
    }

    // 🔹 Call Cloudflare AI
    const aiResponse = await axios.post(
      `${BASE_URL}/@cf/meta/llama-3-8b-instruct`,
      {
        messages: [{ role: "user", content: message }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply = aiResponse.data.result.response;

    // 🔹 Send message into Stream channel
    const channel = streamServer.channel("messaging", channelId);

    await channel.sendMessage({
      text: reply,
      user_id: "ai",
    });

    res.json({ reply });

  } catch (err) {
    console.error("AI ERROR:", err.response?.data || err.message);

    res.status(500).json({
      error: "AI failed",
    });
  }
});

module.exports = router;
