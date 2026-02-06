// routes/stream.routes.js
const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

router.post("/token", async (req, res) => {
  const { user_id, name } = req.body;

  if (!user_id || !name) return res.status(400).json({ ok: false, error: "Missing user info" });

  try {
    // Upsert user server-side
    await serverClient.upsertUser({ id: user_id, name });

    // Generate a user token (server-side!)
    const token = serverClient.createToken(user_id);

    res.status(200).json({ ok: true, token });
  } catch (err) {
    console.error("Stream token creation failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
