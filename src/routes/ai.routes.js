router.post("/", async (req, res) => {
  try {
    const { type, message, channel } = req.body;
    const channel_id = channel?.id;

    if (!channel_id) {
      return res.status(400).json({ error: "Missing channel_id" });
    }

    if (type !== "message.new") {
      return res.json({ received: true });
    }

    if (message?.user?.id === "ai-assistant") {
      return res.json({ ignored: true });
    }

    // 🔥 Call Cloudflare AI
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

    const aiText =
      result?.result?.response ||
      "Sorry, I didn’t quite get that. Can you rephrase?";

    // 🔥 IMPORTANT: do NOT call watch() here
    const streamChannel = client.channel("messaging", channel_id);

    await streamChannel.sendMessage({
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