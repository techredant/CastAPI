const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

// ================= CREATE AI ASSISTANT USER =================
// POST /api/upsertai
router.post("/", async (req, res) => {
  const { user_id, name } = req.body;

  if (!user_id || !name) {
    return res.status(400).json({ ok: false, error: "Missing user info" });
  }

  try {
    // 1️⃣ Ensure real user exists
    await serverClient.upsertUser({
      id: user_id,
      name,
    });

    // 2️⃣ Ensure AI broad exists (IMPORTANT 🔥)
    await serverClient.upsertUser({
      id: "ai-broad",
      name: "AI Assistant",
      image: "https://placekitten.com/200/200",
    });

    // 3️⃣ Create token
    const token = serverClient.createToken(user_id);

    res.status(200).json({ ok: true, token });
  } catch (err) {
    console.error("Stream token creation failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


module.exports = router;