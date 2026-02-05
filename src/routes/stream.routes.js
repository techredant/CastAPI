const express = require("express");
const { StreamChat } = require("stream-chat");

const router = express.Router();

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

router.get("/stream-token", async (req, res) => {
  try {
    const userId = req.query.userId; // or from auth middleware

    if (!userId) {
      return res.status(400).json({ message: "Missing userId" });
    }

    const token = serverClient.createToken(userId);

    res.status(200).json({ token });
  } catch (err) {
    console.error("Stream token error:", err);
    res.status(500).json({ message: "Failed to create token" });
  }
});

module.exports = router;
