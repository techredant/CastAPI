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

// Middleware to parse JSON body
router.use(express.json());

// ✅ Endpoint to get or create AI channel
router.post("/", async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ ok: false, error: "Missing user_id" });
  }

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

    // watch() safely creates or retrieves the channel
    await channel.watch();

    return res.status(200).json({ ok: true, channel_id: channelId });
  } catch (err) {
    console.error("AI channel creation failed:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ Endpoint for AI to reply to messages
router.post("/ai-reply", async (req, res) => {
  const { message, channel_id } = req.body;

  if (!message?.text || !channel_id) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const channel = streamClient.channel("messaging", channel_id);

    // Show AI typing
    await channel.sendEvent({ type: "ai.typing" });

    // Generate AI response
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful AI assistant." },
        { role: "user", content: message.text },
      ],
    });

    const aiReply = completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";

    // Send AI message
    await channel.sendMessage({
      text: aiReply,
      user_id: "ai-assistant",
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("AI reply error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
