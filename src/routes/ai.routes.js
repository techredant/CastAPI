// routes/ai.routes.js
const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");
const OpenAI = require("openai");

// Stream client for sending messages as AI
const client = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post("/", async (req, res) => {
  const { type, message, channel_id } = req.body;

  if (type !== "message.new" || message?.user?.id === "ai-assistant") {
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const channel = client.channel("messaging", channel_id);
    await channel.watch();

    // Generate AI reply
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: message.text }],
    });

    const aiText = completion.choices[0].message.content;

    // Send AI message
    await channel.sendMessage({
      text: aiText,
      user_id: "ai-assistant",
    });

    return res.json({ success: true, reply: aiText });
  } catch (err) {
    console.error("AI reply error:", err);
    return res.status(500).json({ error: "AI failed" });
  }
});

module.exports = router;
