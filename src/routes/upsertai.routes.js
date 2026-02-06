const express = require("express");
const router = express.Router();

const { StreamChat } = require("stream-chat");

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

router.post("/upsert-ai", async (req, res) => {
  try {
    await streamClient.upsertUser({
      id: "ai-assistant",
      name: "AI Assistant",
      role: "admin",
      image: "https://i.imgur.com/7k12EPD.png",
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Upsert AI failed:", err);
    res.status(500).json({ error: "Failed to create AI user" });
  }
});

module.exports = router;