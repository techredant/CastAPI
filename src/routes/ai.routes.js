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
    id: "ai-bot",
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
  try {
    const event = req.body;

    // ✅ Only handle new user messages
    if (
      event.type !== "message.new" ||
      !event.message?.text ||
      event.message.user?.id === "ai-bot"
    ) {
      return res.status(200).end();
    }

    console.log("💬 user message:", event.message.text);

    const channel = serverClient.channel(
      event.channel_type,
      event.channel_id
    );

    // 🔵 Start typing
    await channel.lastTypingEvent({ user_id: "ai-bot" });

    let aiReply;
    try {
      aiReply = await getAIReply(event.message.text);
    } catch (aiErr) {
      console.error("❌ OpenAI error:", aiErr);
      aiReply = "⚠️ Sorry, I had trouble thinking just now.";
    }

    await channel.sendMessage({
      text: aiReply,
      user_id: "ai-bot",
    });

  } catch (err) {
    console.error("❌ AI webhook error:", err);
  } finally {
    // 🔵 Always stop typing
    try {
      const channel = serverClient.channel(
        req.body.channel_type,
        req.body.channel_id
      );
      await channel.lastTypingEvent({ user_id: "ai-bot" });
    } catch {}
  }

  // ⚠️ Always return 200 to Stream
  res.status(200).end();
});

module.exports = router;
