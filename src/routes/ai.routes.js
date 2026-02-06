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

router.post("/ai-reply", async (req, res) => {
  try {
    const { message, channel_id } = req.body;

    if (!message?.text || !channel_id) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    // 1️⃣ Get channel
    const channel = streamClient.channel("messaging", channel_id);

    // 2️⃣ Show AI typing indicator
    await channel.sendEvent({
      type: "ai.typing",
    });

    // 3️⃣ Call AI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful AI assistant.",
        },
        {
          role: "user",
          content: message.text,
        },
      ],
    });

    const aiReply =
      completion.choices[0]?.message?.content ||
      "Sorry, I couldn't generate a response.";

    // 4️⃣ Send AI message to Stream
    await channel.sendMessage({
      text: aiReply,
      user_id: "ai-assistant",
    });

    // 5️⃣ Done
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("AI reply error:", err);
    res.status(500).json({ error: "AI failed" });
  }
});


module.exports = router;
