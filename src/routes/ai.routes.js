// const express = require("express");
// const router = express.Router();
// const { StreamChat } = require("stream-chat");

// const client = StreamChat.getInstance(
//   process.env.STREAM_API_KEY,
//   process.env.STREAM_API_SECRET
// );

// const AI_USER_ID = "ai-assistant";

// router.post("/", async (req, res) => {
//   try {
//     const { type, message, channel } = req.body;

//     // Only react to new messages
//     if (type !== "message.new") {
//       return res.json({ received: true });
//     }

//     // Prevent AI loop
//     if (message.user.id === AI_USER_ID) {
//       return res.json({ ignored: true });
//     }

//     // ---------------- AI CALL ----------------
//     const cfResponse = await fetch(
//       `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
//       {
//         method: "POST",
//         headers: {
//           Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           messages: [
//             { role: "system", content: "You are a helpful AI assistant." },
//             { role: "user", content: message.text },
//           ],
//         }),
//       }
//     );

//     const result = await cfResponse.json();
//     const aiText =
//       result?.result?.response || "I'm here to help 🙂";

//     // ---------------- SEND TO STREAM ----------------
//     const channelRef = client.channel("messaging", channel.id);
//     await channelRef.sendMessage({
//       text: aiText,
//       user_id: AI_USER_ID,
//     });

//     return res.json({ success: true });
//   } catch (err) {
//     console.error("AI webhook error:", err);
//     return res.status(500).json({ error: "AI failed" });
//   }
// });

// module.exports = router;


const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");
// const OpenAI = require("openai"); // or whatever AI SDK you use

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

// Example AI function (replace with your real AI call)
async function getAIReply(userText) {
  // TODO: call OpenAI / your model here
  return `🤖 AI says: You said "${userText}"`;
}

router.post("/", async (req, res) => {
  const { channelId, text } = req.body;

  if (!channelId || !text) {
    return res.status(400).json({ ok: false, error: "Missing channelId or text" });
  }

  try {
    // 1️⃣ Generate AI response
    const aiReply = await getAIReply(text);

    // 2️⃣ Send message to Stream as ai-bot
    const channel = serverClient.channel("messaging", channelId);

    await channel.sendMessage({
      text: aiReply,
      user_id: "ai-bot",
    });

    res.status(200).json({ ok: true, message: "AI reply sent" });
  } catch (err) {
    console.error("AI reply failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
