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
  const event = req.body;

  // ✅ Only respond to new user messages
  if (
    event.type !== "message.new" ||
    !event.message?.text ||
    event.message.user.id === "ai-bot"
  ) {
    return res.status(200).end();
  }

  const channel = serverClient.channel(
    event.channel_type,
    event.channel_id
  );

  try {
    // 🔵 start typing
    await channel.sendEvent({
      type: "typing.start",
      user_id: "ai-bot",
    });

    const aiReply = await getAIReply(event.message.text);

    await channel.sendMessage({
      text: aiReply,
      user_id: "ai-bot",
    });

  } catch (err) {
    console.error("AI webhook error:", err);

  } finally {
    // 🔵 stop typing ALWAYS
    await channel.sendEvent({
      type: "typing.stop",
      user_id: "ai-bot",
    });
  }

  res.status(200).end();
});

module.exports = router;
