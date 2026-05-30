const { StreamChat } = require("stream-chat");

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

async function ensureMissedCallChatMessage(callId, callerId, callType = "video") {
  if (!callId || !callerId) return;

  try {
    const channel = serverClient.channel("messaging", callId);
    const { messages } = await channel.query({ messages: { limit: 8 } });

    const alreadyPosted = messages?.some((m) =>
      m.attachments?.some(
        (a) => a.type === "call_missed" && (a.call_id === callId || !a.call_id),
      ),
    );

    if (alreadyPosted) return;

    const label =
      callType === "audio" ? "Missed voice call" : "Missed video call";

    await channel.sendMessage({
      text: label,
      user_id: callerId,
      attachments: [
        {
          type: "call_missed",
          call_type: callType,
          call_id: callId,
          title: label,
        },
      ],
    });
  } catch (err) {
    console.error("ensureMissedCallChatMessage:", err.message);
  }
}

module.exports = { ensureMissedCallChatMessage };
