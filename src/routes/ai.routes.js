const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

const AI_USER_ID = "ai-assistant";

// Stream client
const client = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

// Ensure AI user exists ONCE
(async () => {
  try {
    await client.upsertUser({
      id: AI_USER_ID,
      name: "AI Assistant 🤖",
    });
  } catch (e) {
    console.error("AI user upsert failed:", e);
  }
})();

router.post("/", async (req, res) => {
  try {
    const event = req.body;

    console.log("🔥 Stream event:", event.type);

    // Only respond to new user messages
    if (
      event.type !== "message.new" ||
      !event.message?.text ||
      event.message.user?.id === AI_USER_ID
    ) {
      return res.json({ ignored: true });
    }

    const channel = client.channel(
      event.channel_type,
      event.channel_id
    );

    await channel.watch();

    // ⌨️ typing start
    await channel.sendEvent({
      type: "typing.start",
      user_id: AI_USER_ID,
    });

    // -------------------------
    // 🌩️ Cloudflare AI
    // -------------------------
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
            { role: "user", content: event.message.text },
          ],
        }),
      }
    );

    // 🔒 NEVER trust external APIs
    const raw = await cfResponse.text();
    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      console.error("❌ Cloudflare non-JSON:", raw);
      throw new Error("Cloudflare returned HTML");
    }

    const aiText =
      result?.result?.response || "Sorry, I couldn’t think of a reply.";

    // -------------------------
    // 📤 Send AI message
    // -------------------------
    await channel.sendMessage({
      text: aiText,
      user_id: AI_USER_ID,
    });

    // ⌨️ typing stop
    await channel.sendEvent({
      type: "typing.stop",
      user_id: AI_USER_ID,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("AI webhook error:", err);
    return res.status(500).json({ error: "AI failed" });
  }
});

module.exports = router;
