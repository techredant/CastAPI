// routes/stream.routes.js
const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

router.post("/token", async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ ok: false, error: "Missing userId" });
  }

  try {
    await serverClient.upsertUser({ id: userId });

    const token = serverClient.createToken(userId);

    res.status(200).json({ ok: true, token });
  } catch (err) {
    console.error("Stream token creation failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/video-token
router.post("/video-token", async (req, res) => {
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const token = serverClient.createToken(userId);

  res.json({ token });
});


module.exports = router;
