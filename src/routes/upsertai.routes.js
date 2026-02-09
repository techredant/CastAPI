// routes/upsertai.routes.js
const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

// Make sure these env vars exist
const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

router.post("/", async (req, res) => {
  const { user_id, name } = req.body;

  if (!user_id || !name) {
    return res.status(400).json({ error: "Missing user info" });
  }

  try {
    // Ensure real user exists
    await serverClient.upsertUser({ id: user_id, name });

    // Ensure AI exists
    await serverClient.upsertUser({
      id: "ai-assistant",
      name: "AI Assistant",
      image: "https://placekitten.com/200/200",
    });

    // Create token for the real user
    const token = serverClient.createToken(user_id);

    return res.status(200).json({ token });
  } catch (err) {
    console.error("Stream token error:", err);
    return res.status(500).json({ error: "Token failed" });
  }
});

module.exports = router;
