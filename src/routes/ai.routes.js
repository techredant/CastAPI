// const express = require("express");
// const router = express.Router();
// const { StreamChat } = require("stream-chat");
// const OpenAI = require("openai");

// const serverClient = StreamChat.getInstance(
//   process.env.STREAM_API_KEY,
//   process.env.STREAM_API_SECRET
// );

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// // 🔐 Ensure AI user exists (do this once)
// async function ensureAiUser() {
//   await serverClient.upsertUser({
//     id: "ai-broad",
//     name: "AI Assistant",
//   });
// }
// ensureAiUser();

// async function getAIReply(text) {
//   const completion = await openai.chat.completions.create({
//     model: "gpt-4.1-mini",
//     messages: [{ role: "user", content: text }],
//   });

//   return completion.choices[0].message.content;
// }

// router.post("/", async (req, res) => {
//   const event = req.body;

//   try {
//     if (
//       event.type !== "message.new" ||
//       !event.message?.text ||
//       event.message.user?.id === "ai-broad"
//     ) {
//       return res.status(200).end();
//     }

//     console.log("💬 user message:", event.message.text);

//     const channel = serverClient.channel(
//       event.channel_type,
//       event.channel_id
//     );

//     // 👀 REQUIRED for bots
//     await channel.watch();

//     // ⌨️ typing start
//     await channel.sendEvent({
//       type: "typing.start",
//       user_id: "ai-broad",
//     });

//     let aiReply;
//     try {
//       aiReply = await getAIReply(event.message.text);
//     } catch (err) {
//       console.error("❌ OpenAI error:", err);
//       aiReply = "⚠️ Sorry, I had a brain freeze.";
//     }

//     await channel.sendMessage({
//       text: aiReply,
//       user_id: "ai-broad",
//     });

//     // ⌨️ typing stop
//     await channel.sendEvent({
//       type: "typing.stop",
//       user_id: "ai-broad",
//     });

//   } catch (err) {
//     console.error("❌ AI webhook error:", err);
//   }

//   res.status(200).end();
// });

// module.exports = router;

const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");

// Stream client
const client = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET_KEY
);

// POST WEBHOOK FROM STREAM
router.post("/ai-reply", async (req, res) => {
  try {
    const body = req.body;
    const type = body.type;
    const message = body.message;
    const channel_id = body.channel?.id || body.channel_id;

    console.log("Incoming webhook:", type);

    // Ignore non-new messages
    if (type !== "message.new") {
      return res.json({ received: true });
    }

    // Prevent AI replying to itself
    if (message?.user?.id === "ai-assistant") {
      return res.json({ ignored: true });
    }

    // ---------------------------
    // 1️⃣ CALL CLOUDFLARE AI
    // ---------------------------
    console.log("Calling Cloudflare AI...");

    const cfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are a helpful AI assistant." },
            { role: "user", content: message.text },
          ],
        }),
      }
    );

    const result = await cfResponse.json();
    console.log("CF RAW RESPONSE:", result);

    const aiResponse =
      result?.result?.response || "Hello! How can I help you?";

    // ---------------------------
    // 2️⃣ SEND MESSAGE TO STREAM
    // ---------------------------
    console.log("Sending AI message to channel:", channel_id);

    const channel = client.channel("messaging", channel_id, {
      created_by_id: "ai-assistant",
    });

    await channel.watch();

    await channel.sendMessage({
      text: aiResponse,
      user_id: "ai-assistant",
    });

    return res.json({ success: true, reply: aiResponse });
  } catch (error) {
    console.error("AI reply error:", error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;