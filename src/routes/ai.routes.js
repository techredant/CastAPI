const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

// Stream server client
const client = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

router.post("/", async (req, res) => {
  try {
    const { type, message, channel_id } = req.body;

    console.log("Incoming webhook:", type);

    // Only respond to new messages
    if (type !== "message.new") {
      return res.json({ received: true });
    }

    // Prevent AI replying to itself
    if (message?.user?.id === "ai-assistant") {
      return res.json({ ignored: true });
    }

    // 1️⃣ Call Cloudflare AI
    const cfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are a helpful AI assistant in a chat app." },
            { role: "user", content: message.text },
          ],
        }),
      }
    );

    const result = await cfResponse.json();
    console.log("CF RAW RESPONSE:", result);

    const aiText =
      result?.result?.response ||
      "Sorry, I didn’t quite get that. Can you rephrase?";

    // 2️⃣ Send AI message to Stream
    const channel = client.channel("messaging", channel_id);
    await channel.watch();

    await channel.sendMessage({
      text: aiText,
      user_id: "ai-assistant",
    });

    return res.json({ success: true, reply: aiText });
  } catch (error) {
    console.error("AI reply error:", error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
