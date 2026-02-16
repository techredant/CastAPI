const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

router.post("/", async (req, res) => {
  try {
    const { message, channel_id } = req.body;

    if (!message || !channel_id) {
      return res.status(400).json({ error: "Missing message or channel_id" });
    }

    // 1️⃣ Call Flare AI
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

    const cfData = await cfResponse.json();
    const aiText = cfData?.result?.response || "Sorry, I didn't understand that.";

    // 2️⃣ Send AI reply to Stream
    const channel = serverClient.channel("messaging", channel_id);
    await channel.watch(); // ensure channel is loaded

    await channel.sendMessage({
      text: aiText,
      user_id: message.user.id, // or a placeholder like "ai"
    });

    res.json({ success: true, reply: aiText });
  } catch (err) {
    console.error("AI reply error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
