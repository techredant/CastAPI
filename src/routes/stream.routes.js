// // routes/stream.routes.js

// const express = require("express");
// const router = express.Router();
// const { StreamChat } = require("stream-chat");

// // Initialize Stream server client
// const serverClient = StreamChat.getInstance(
//   process.env.STREAM_API_KEY,
//   process.env.STREAM_API_SECRET,
// );

// /**
//  * POST /stream/token
//  * Creates (or updates) a Stream user and returns a chat token
//  */
// router.post("/token", async (req, res) => {
//   const { userId, name, image, isHost } = req.body;

//   if (!userId) {
//     return res.status(400).json({
//       ok: false,
//       error: "Missing userId",
//     });
//   }

//   try {
//     await serverClient.upsertUser({
//       id: userId,
//       name: name || "User",
//       image: image || undefined,
//     });

//     // ✅ KEY FIX: assign role
//     const token = serverClient.createToken(userId, undefined, undefined, {
//       role: isHost ? "admin" : "user",
//     });

//     return res.status(200).json({
//       ok: true,
//       token,
//     });
//   } catch (err) {
//     console.error("Stream token creation failed:", err);
//     return res.status(500).json({
//       ok: false,
//       error: err.message,
//     });
//   }
// });

// /**
//  * POST /stream/video-token
//  * Generates Stream video token
//  */
// router.post("/video-token", async (req, res) => {
//   const { userId } = req.body;

//   if (!userId) {
//     return res.status(400).json({
//       ok: false,
//       error: "Missing userId",
//     });
//   }

//   try {
//     const token = serverClient.createToken(userId);

//     return res.status(200).json({
//       ok: true,
//       token,
//     });
//   } catch (err) {
//     console.error("Video token creation failed:", err);
//     return res.status(500).json({
//       ok: false,
//       error: err.message,
//     });
//   }
// });

// module.exports = router;

const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");
const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);
// router.post("/token", async (req, res) => {
//   const { userId, name, image } = req.body;
//   if (!userId) {
//     return res.status(400).json({ ok: false, error: "Missing userId" });
//   }
//   try {
//     //  Upsert user in Stream (creates if not exists)
//     await serverClient.upsertUser({
//       id: userId,
//       name: name || "User",
//       image: image || undefined,
//     });
//     // Generate Stream token
//     const token = serverClient.createToken(userId);
//     return res.status(200).json({ ok: true, token });
//   } catch (err) {
//     console.error("Stream token creation failed:", err);
//     return res.status(500).json({ ok: false, error: err.message });
//   }
// });
/** * POST /stream/video-token * Generates Stream video token */

router.post("/token", async (req, res) => {
  try {
    const { userId, name, image } = req.body;

    if (!userId) {
      return res.status(400).json({ ok: false, error: "Missing userId" });
    }

    await serverClient.upsertUser({
      id: userId,
      name: name || "User",
      image: image || undefined,
    });

    const token = serverClient.createToken(userId);

    return res.status(200).json({ ok: true, token });
  } catch (err) {
    console.error("TOKEN ERROR:", err);

    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});
router.post("/video-token", async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ ok: false, error: "Missing userId" });
  }
  try {
    const token = serverClient.createToken(userId);
    return res.status(200).json({ ok: true, token });
  } catch (err) {
    console.error("Video token creation failed:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});
module.exports = router;
