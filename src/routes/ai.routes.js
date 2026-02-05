const express = require("express");
const router = express.Router();

router.post("/ai-reply", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages format" });
    }

    console.log("AI CHAT REQUEST:", messages[messages.length - 1]);

    const cfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messages.map((m) => ({
            role: m.role === "ai" ? "assistant" : "user",
            content: m.text,
          })),
        }),
      }
    );

    const result = await cfResponse.json();

    console.log("CF RESPONSE:", result);

    const reply =
      result?.result?.response ||
      "Sorry, I couldn't generate a response.";

    return res.json({ reply });
  } catch (error) {
    console.error("AI CHAT ERROR:", error);
    return res.status(500).json({ error: "AI failed" });
  }
});

module.exports = router;
