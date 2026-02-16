const express = require("express");
const axios = require("axios");

const router = express.Router();

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run`;

// 🔥 Chat endpoint
router.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await axios.post(
      `${BASE_URL}/@cf/meta/llama-3-8b-instruct`,
      {
        messages: [{ role: "user", content: message }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      reply: response.data.result.response,
    });
  } catch (err) {
    console.error("AI ERROR:", err.response?.data || err.message);

    res.status(500).json({
      error: "AI failed",
      details: err.response?.data,
    });
  }
});

module.exports = router;
