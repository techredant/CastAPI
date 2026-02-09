const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");
const OpenAI = require("openai");

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🔐 Ensure AI user exists (do this once)
async function ensureAiUser() {
  await serverClient.upsertUser({
    id: "ai-broad",
    name: "AI Assistant",
  });
}
ensureAiUser();

async function getAIReply(text) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: text }],
  });

  return completion.choices[0].message.content;
}

router.post("/", async (req, res) => {
  const event = req.body;

  try {
    if (
      event.type !== "message.new" ||
      !event.message?.text ||
      event.message.user?.id === "ai-broad"
    ) {
      return res.status(200).end();
    }

    console.log("💬 user message:", event.message.text);

    const channel = serverClient.channel(
      event.channel_type,
      event.channel_id
    );

    // 👀 REQUIRED for bots
    await channel.watch();

    // ⌨️ typing start
    await channel.sendEvent({
      type: "typing.start",
      user_id: "ai-broad",
    });

    let aiReply;
    try {
      aiReply = await getAIReply(event.message.text);
    } catch (err) {
      console.error("❌ OpenAI error:", err);
      aiReply = "⚠️ Sorry, I had a brain freeze.";
    }

    await channel.sendMessage({
      text: aiReply,
      user_id: "ai-broad",
    });

    // ⌨️ typing stop
    await channel.sendEvent({
      type: "typing.stop",
      user_id: "ai-broad",
    });

  } catch (err) {
    console.error("❌ AI webhook error:", err);
  }

  res.status(200).end();
});

module.exports = router;
