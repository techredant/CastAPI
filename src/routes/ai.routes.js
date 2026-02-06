const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");
const OpenAI = require("openai");

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getAIReply(text) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: text }],
  });

  return completion.choices[0].message.content;
}

router.post("/", async (req, res) => {
  const { channelId, text } = req.body;

  if (!channelId || !text) {
    return res.status(400).json({ ok: false, error: "Missing channelId or text" });
  }

  try {
    // Generate AI response
    const aiReply = await getAIReply(text);

    if (!aiReply || !aiReply.trim()) {
      throw new Error("AI returned empty response");
    }

    // Send message to Stream as ai-bot
    const channel = serverClient.channel("messaging", channelId);
    await channel.watch(); // ensure channel exists
    await channel.sendMessage({
      text: aiReply,
      user_id: "ai-bot",
    });

    res.status(200).json({ ok: true, message: "AI reply sent" });
  } catch (err) {
    console.error("AI reply failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
