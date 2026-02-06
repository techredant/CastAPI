const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

// Stream client
const client = StreamChat.getInstance(
  pprocess.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET // server secret
);

// POST WEBHOOK FROM STREAM
router.post("/ai-reply", async (req, res) => {
  try {
    const body = req.body;
    const type = body.type;
    const message = body.message;
    const channel_id = body.channel?.id || body.channel_id;

    console.log("Incoming webhook:", type);

    // Ignore non-new messages
    if (type !== "message.new") {
      return res.json({ received: true });
    }

    // Prevent AI replying to itself
    if (message?.user?.id === "ai-assistant") {
      return res.json({ ignored: true });
    }

    // ---------------------------
    // 1️⃣ CALL CLOUDFLARE AI
    // ---------------------------
    console.log("Calling Cloudflare AI...");

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
            { role: "system", content: "You are a helpful AI assistant." },
            { role: "user", content: message.text },
          ],
        }),
      }
    );

    const result = await cfResponse.json();
    console.log("CF RAW RESPONSE:", result);

    const aiResponse =
      result?.result?.response || "Hello! How can I help you?";

    // ---------------------------
    // 2️⃣ SEND MESSAGE TO STREAM
    // ---------------------------
    console.log("Sending AI message to channel:", channel_id);

    const channel = client.channel("messaging", channel_id, {
      created_by_id: "ai-assistant",
    });

    await channel.watch();

    await channel.sendMessage({
      text: aiResponse,
      user_id: "ai-assistant",
    });

    return res.json({ success: true, reply: aiResponse });
  } catch (error) {
    console.error("AI reply error:", error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;