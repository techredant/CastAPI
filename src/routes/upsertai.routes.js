const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

// -------------------
// Load Stream client
// -------------------
if (!process.env.STREAM_API_KEY || !process.env.STREAM_API_SECRET) {
  console.error("❌ STREAM_API_KEY or STREAM_API_SECRET is missing!");
}

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

// -------------------
// POST /api/upsertai
// -------------------
router.post("/", async (req, res) => {
  const { user_id, name } = req.body;

  if (!user_id || !name) {
    return res.status(400).json({ error: "Missing user info" });
  }

  try {
    // Ensure real user exists
    await serverClient.upsertUser({
      id: user_id,
      name,
    });

    // Ensure AI exists
    await serverClient.upsertUser({
      id: "ai-assistant",
      name: "AI Assistant",
      image: "https://placekitten.com/200/200",
    });

    // ✅ Create Stream token
    const token = serverClient.createToken(user_id);

    console.log(`🔑 Token created for ${user_id}: ${token.substring(0, 10)}...`);

    return res.status(200).json({ token });
  } catch (err) {
    console.error("❌ Stream token error:", err);
    return res.status(500).json({ error: "Token failed" });
  }
});

module.exports = router;
