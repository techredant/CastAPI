
const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");
const User = require("../models/user");
const { notify } = require("../services/notificationEngine.service");

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

function displayNameFromDbUser(user) {
  if (!user) return null;
  const full = `${user.firstName || ""} ${user.lastName || ""}`.trim();
  if (full) return full;
  if (user.companyName?.trim()) return user.companyName.trim();
  if (user.nickName?.trim()) return user.nickName.trim();
  return null;
}

const chatPushDedup = new Map();
const CHAT_PUSH_DEDUP_MS = 2 * 60 * 1000;

function shouldSendChatPush(messageId) {
  if (!messageId) return true;
  const last = chatPushDedup.get(messageId);
  if (last && Date.now() - last < CHAT_PUSH_DEDUP_MS) return false;
  chatPushDedup.set(messageId, Date.now());
  return true;
}

function extractChannelMemberIds(state, channel) {
  const members = state?.members || channel?.state?.members || {};
  if (Array.isArray(members)) {
    return members
      .map((member) => member.user_id || member.user?.id)
      .filter(Boolean);
  }
  return Object.values(members)
    .map((member) => member.user_id || member.user?.id)
    .filter(Boolean);
}

async function notifyChatMessageRecipients({
  channelType,
  channelId,
  senderId,
  preview,
  senderName,
  messageId,
  io,
}) {
  if (!channelId || !senderId || !preview) return { pushSent: 0 };

  if (messageId && !shouldSendChatPush(messageId)) {
    return { pushSent: 0, skipped: "dedup" };
  }

  let memberIds = [];

  try {
    const channel = serverClient.channel(channelType || "messaging", channelId);
    const state = await channel.query({ messages: { limit: 0 } });
    memberIds = extractChannelMemberIds(state, channel);
  } catch (err) {
    console.error("chat notify member lookup:", err.message);
    return { pushSent: 0 };
  }

  const recipients = memberIds.filter((id) => id && id !== senderId);
  let pushSent = 0;

  for (const memberId of recipients) {
    const sender = await User.findOne({ clerkId: senderId }).select("image");
    const isGroup = memberIds.length > 2;

    await notify({
      userId: memberId,
      type: isGroup ? "group_message" : "message",
      title: senderName || "New message",
      body: preview,
      actor: {
        userId: senderId,
        name: senderName,
        image: sender?.image,
      },
      entityId: channelId,
      entityType: "chat",
      data: {
        screen: "chat",
        channelId,
        category: "messages",
      },
      io,
      dedupeWindowMs: CHAT_PUSH_DEDUP_MS,
    });
    pushSent += 1;
  }

  return { pushSent };
}

function messagePreview(message) {
  if (message?.text?.trim()) return message.text.trim();

  const attachments = message?.attachments || [];
  if (attachments.some((a) => a.type === "call_missed")) return null;
  if (attachments.some((a) => a.type === "image" || a.image_url))
    return "Sent a photo";
  if (attachments.some((a) => a.type === "video")) return "Sent a video";
  if (attachments.some((a) => a.type === "audio")) return "Sent a voice note";
  if (attachments.some((a) => a.productId)) return "Sent a product";

  return "New message";
}

async function handleChatWebhook(body, io) {
  if (body.type !== "message.new") return;

  const message = body.message;
  const senderId = message?.user?.id || body.user?.id;

  if (!message || !senderId) return;

  if (message.attachments?.some((a) => a.type === "call_missed")) return;

  const channelType = body.channel_type || message.channel?.type || "messaging";
  const channelId =
    body.channel_id || message.channel?.id || message.cid?.split(":")[1];

  if (!channelId) return;

  const preview = messagePreview(message);
  if (!preview) return;

  let senderName = message.user?.name || body.user?.name;
  if (!senderName || String(senderName).startsWith("user_")) {
    const sender = await User.findOne({ clerkId: senderId });
    senderName = displayNameFromDbUser(sender) || "Someone";
  }

  await notifyChatMessageRecipients({
    channelType,
    channelId,
    senderId,
    preview,
    senderName,
    messageId: message.id,
    io,
  });
}

const chatWebhookHandler = async (req, res) => {
  try {
    await handleChatWebhook(req.body, req.app.get("io"));
    res.sendStatus(200);
  } catch (err) {
    console.error("Chat webhook error:", err);
    res.sendStatus(500);
  }
};

router.post("/sync-profiles", async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const unique = [...new Set(ids.filter(Boolean))].filter(
      (id) => id !== "ai-assistant",
    );

    if (unique.length === 0) {
      return res.status(200).json({ profiles: [] });
    }

    const users = await User.find({ clerkId: { $in: unique } });
    const profiles = users.map((u) => ({
      clerkId: u.clerkId,
      name: displayNameFromDbUser(u) || "Member",
      image: u.image || null,
    }));

    if (profiles.length) {
      await serverClient.upsertUsers(
        profiles.map((p) => ({
          id: p.clerkId,
          name: p.name,
          image: p.image || undefined,
        })),
      );
    }

    return res.status(200).json({ profiles });
  } catch (err) {
    console.error("SYNC PROFILES ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/notify-chat", async (req, res) => {
  try {
    const {
      messageId,
      channelId,
      channelType,
      senderId,
      text,
      senderName: senderNameBody,
    } = req.body;

    if (!channelId || !senderId) {
      return res.status(400).json({ error: "channelId and senderId required" });
    }

    const preview =
      typeof text === "string" && text.trim()
        ? text.trim().slice(0, 120)
        : "New message";

    let senderName = senderNameBody;
    if (!senderName || String(senderName).startsWith("user_")) {
      const sender = await User.findOne({ clerkId: senderId });
      senderName = displayNameFromDbUser(sender) || "Someone";
    }

    const result = await notifyChatMessageRecipients({
      channelType: channelType || "messaging",
      channelId,
      senderId,
      preview,
      senderName,
      messageId,
      io: req.app.get("io"),
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("NOTIFY CHAT ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/upsert-user", async (req, res) => {
  try {
    let { userId, name, image } = req.body;

    if (!userId) {
      return res.status(400).json({ ok: false, error: "Missing userId" });
    }

    if (!name) {
      const dbUser = await User.findOne({ clerkId: userId });
      if (dbUser) {
        name =
          `${dbUser.firstName || ""} ${dbUser.lastName || ""}`.trim() ||
          dbUser.companyName ||
          dbUser.nickName;
        image = image || dbUser.image;
      }
    }

    let safeName = (name && String(name).trim()) || "";
    if (!safeName || safeName.startsWith("user_")) {
      safeName = displayNameFromDbUser(
        await User.findOne({ clerkId: userId }),
      ) || "Member";
    }

    await serverClient.upsertUser({
      id: userId,
      name: safeName,
      image: image || undefined,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("UPSERT USER ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/token", async (req, res) => {
  try {
    let { userId, name, image } = req.body;

    if (!userId) {
      return res.status(400).json({ ok: false, error: "Missing userId" });
    }

    if (!name || String(name).startsWith("user_")) {
      const dbUser = await User.findOne({ clerkId: userId });
      name = displayNameFromDbUser(dbUser) || "Member";
      image = image || dbUser?.image;
    }

    await serverClient.upsertUser({
      id: userId,
      name,
      image,
    });

    await serverClient.partialUpdateUser({
      id: userId,
      set: { name, image },
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

router.post("/chat-webhook", chatWebhookHandler);

module.exports = router;
