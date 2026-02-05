const express = require("express");
const cors = require("cors");
const { StreamChat } = require("stream-chat");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const STREAM_KEY = process.env.STREAM_CHAT_KEY;
const STREAM_SECRET = process.env.STREAM_CHAT_SECRET;

if (!STREAM_KEY || !STREAM_SECRET) {
  throw new Error("❌ Missing Stream API key or secret in environment variables");
}

const serverClient = StreamChat.getInstance(
  STREAM_KEY,
  STREAM_SECRET
);

/**
 * Create Stream token
 * MUST be fresh on every request
 */
app.post("/api/stream/token", async (req, res) => {
  const { userId, name, image } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    // 🔐 Ensure user exists in Stream
    await serverClient.upsertUser({
      id: userId,
      name: name || "User",
      image,
    });

    // 🔥 DO NOT pass exp — Stream handles it safely
    const token = serverClient.createToken(userId);

    return res.status(200).json({ token });
  } catch (err) {
    console.error("❌ Stream token error:", err);
    return res.status(500).json({ error: "Failed to create Stream token" });
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Stream server running on port ${PORT}`)
);

