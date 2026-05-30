
const express = require("express");
const router = express.Router();
const { StreamChat } = require("stream-chat");
const User = require("../models/user");
const {
  sendMissedCallPush,
  sendNoAnswerCallPush,
} = require("../../services/pushNotification.service");
const { notify } = require("../services/notificationEngine.service");

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

function getCallMemberIds(call) {
  const members = call?.members;
  if (!members) return [];

  if (Array.isArray(members)) {
    return members.map((m) => m.user_id || m.user?.id).filter(Boolean);
  }

  return Object.values(members)
    .map((m) => m.user_id || m.user?.id)
    .filter(Boolean);
}

function getCallerId(call, eventUser) {
  return call?.created_by?.id || call?.created_by_id || eventUser?.id;
}

/** Prefer Stream video settings over stale custom.callMode from prior voice sessions. */
function resolveCallModeFromWebhookCall(call) {
  const videoEnabled = call?.settings?.video?.enabled;
  if (videoEnabled === true) return "video";
  if (videoEnabled === false) return "audio";
  if (call?.custom?.callMode === "audio") return "audio";
  if (call?.custom?.callMode === "video") return "video";
  return "video";
}

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

async function handleVideoWebhook(event) {
  const call = event.call;
  const actor = event.user;

  if (event.type === "call.ring") {
    const caller = actor;
    if (!call || !caller) return;

    const recipientIds = getCallMemberIds(call).filter((id) => id !== caller.id);
    const callMode = resolveCallModeFromWebhookCall(call);
    const isVideo = callMode === "video";

    const channelCid =
      call.custom?.channel_cid || call.data?.channel_cid || null;
    const callerLabel = caller.name || "Someone";
    const groupLookupHint =
      call.custom?.isGroup === true ||
      call.custom?.is_group === true ||
      (channelCid && String(channelCid).split(":")[1]?.startsWith("group_"));

    const lookupGroupName = async () => {
      if (!groupLookupHint || !channelCid || !String(channelCid).includes(":")) {
        return null;
      }

      try {
        const [channelType, channelId] = String(channelCid).split(":");
        const ch = serverClient.channel(channelType, channelId);
        await ch.query({ messages: { limit: 0 } });
        const memberCount = Object.keys(ch.state.members || {}).length;
        const isGroup =
          ch.data?.is_group === true ||
          memberCount >= 3 ||
          String(channelId).startsWith("group_");
        if (isGroup) {
          return (
            ch.data?.name?.trim() ||
            (memberCount > 0 ? `Group (${memberCount})` : "Group")
          );
        }
      } catch (err) {
        console.warn("call.ring group lookup:", err.message);
      }
      return null;
    };

    const pushTitle = callerLabel;
    const pushBody = `${callerLabel} is calling you`;

    const notifyIncoming = (userId, title, body) =>
      notify({
        userId,
        type: "incoming_call",
        title,
        body,
        actor: {
          userId: caller.id,
          name: callerLabel,
          image: caller.image,
        },
        entityId: call.id,
        entityType: "call",
        data: {
          screen: "call",
          category: "calls",
          callId: call.id,
          callMode,
          isCaller: "false",
          channelId: call.id,
        },
        io: null,
        skipPersist: true,
      });

    await Promise.all(
      recipientIds.map((userId) => notifyIncoming(userId, pushTitle, pushBody)),
    );

    if (groupLookupHint) {
      void lookupGroupName()
        .then((groupName) => {
          if (!groupName) return;
          const groupTitle = `${callerLabel} · ${groupName}`;
          const groupBody = isVideo
            ? "Incoming group video call"
            : "Incoming group voice call";
          return Promise.all(
            recipientIds.map((userId) =>
              notifyIncoming(userId, groupTitle, groupBody),
            ),
          );
        })
        .catch(() => {});
    }
    return;
  }

  if (event.type === "call.missed") {
    const calleeId = actor?.id;
    const callerId = getCallerId(call, actor);
    if (!call?.id || !callerId) return;

    const callMode = resolveCallModeFromWebhookCall(call);
    await ensureMissedCallChatMessage(call.id, callerId, callMode);

    if (calleeId && calleeId !== callerId) {
      const callee = await User.findOne({ clerkId: calleeId });
      const callerName =
        call.created_by?.name || actor?.name || "Someone";

      if (callee?.expoPushToken) {
        await sendMissedCallPush(
          callee.expoPushToken,
          callerName,
          call.id,
          callMode,
        );
      }
    }
    return;
  }

  if (event.type === "call.rejected") {
    const reason = event.reason;
    const callId = call?.id;
    const callerId = getCallerId(call, actor);
    if (!callId || !callerId || !actor?.id) return;

    if (reason === "decline" && actor.id !== callerId) {
      const caller = await User.findOne({ clerkId: callerId });
      if (caller?.expoPushToken) {
        await sendPushNotification(
          caller.expoPushToken,
          "Call declined",
          `${actor.name || "Someone"} declined your call`,
          {
            screen: "chat",
            channelId: callId,
            url: `/(drawer)/(stream)/channel/${callId}`,
          },
        );
      }
      return;
    }

    if (reason === "cancel" && actor.id === callerId) {
      await ensureMissedCallChatMessage(callId, callerId, "video");

      const caller = await User.findOne({ clerkId: callerId });
      if (caller?.expoPushToken) {
        await sendNoAnswerCallPush(caller.expoPushToken, undefined, callId);
      }
    }
  }
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

const videoWebhookHandler = async (req, res) => {
  try {
    await handleVideoWebhook(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("Video webhook error:", err);
    res.sendStatus(500);
  }
};

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

router.post("/webhook", videoWebhookHandler);
router.post("/stream/webhook", videoWebhookHandler);
router.post("/chat-webhook", chatWebhookHandler);

module.exports = router;
