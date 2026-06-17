
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

function parseChannelCid(channelCid) {
  const [channelType, channelId] = String(channelCid || "").split(":");
  if (!channelType || !channelId) return null;
  return { channelType, channelId };
}

function channelMembersList(state) {
  const members = state?.members || {};
  if (Array.isArray(members)) return members;
  return Object.values(members);
}

function channelCustomData(state) {
  return state?.channel?.custom || state?.channel?.data || state?.channel || {};
}

function adminIdSet(custom) {
  const ids = new Set();
  if (custom?.created_by_id) ids.add(String(custom.created_by_id));
  if (Array.isArray(custom?.admin_ids)) {
    custom.admin_ids.forEach((id) => id && ids.add(String(id)));
  }
  return ids;
}

function isGroupAdminFromState(state, userId) {
  if (!userId) return false;
  const custom = channelCustomData(state);
  if (adminIdSet(custom).has(String(userId))) return true;
  const member = channelMembersList(state).find(
    (m) => String(m.user_id || m.user?.id) === String(userId),
  );
  return (
    member?.channel_role === "channel_moderator" ||
    member?.role === "channel_moderator" ||
    member?.is_moderator === true
  );
}

async function queryChannelState(channelCid) {
  const parsed = parseChannelCid(channelCid);
  if (!parsed) throw new Error("Invalid channel id");
  const channel = serverClient.channel(parsed.channelType, parsed.channelId);
  return channel.query({ state: true, watch: false, messages: { limit: 0 } });
}

async function sendGroupSystemMessage(channel, userId, text) {
  if (!text?.trim()) return;
  await channel.sendMessage({ text: text.trim(), user_id: userId });
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

router.post("/group/ensure-admin", async (req, res) => {
  try {
    const { channelCid, userId } = req.body || {};
    if (!channelCid || !userId) {
      return res.status(400).json({ ok: false, error: "channelCid and userId required" });
    }
    const parsed = parseChannelCid(channelCid);
    if (!parsed) {
      return res.status(400).json({ ok: false, error: "Invalid channel id" });
    }
    const state = await queryChannelState(channelCid);
    const custom = channelCustomData(state);
    const adminIds = adminIdSet(custom);
    adminIds.add(String(userId));
    const channel = serverClient.channel(parsed.channelType, parsed.channelId);

    await channel.assignRoles([
      { user_id: String(userId), channel_role: "channel_moderator" },
    ]);

    await channel.updatePartial({
      set: {
        is_group: true,
        created_by_id: custom.created_by_id || String(userId),
        admin_ids: Array.from(adminIds),
      },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("ENSURE GROUP ADMIN ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/group/update", async (req, res) => {
  try {
    const { channelCid, userId, name, image, actorName } = req.body || {};
    if (!channelCid || !userId) {
      return res.status(400).json({ ok: false, error: "channelCid and userId required" });
    }
    const parsed = parseChannelCid(channelCid);
    if (!parsed) {
      return res.status(400).json({ ok: false, error: "Invalid channel id" });
    }

    const state = await queryChannelState(channelCid);
    if (!isGroupAdminFromState(state, userId)) {
      return res.status(403).json({ ok: false, error: "Only group admins can update this group" });
    }

    const set = {};
    if (typeof name === "string" && name.trim()) set.name = name.trim();
    if (typeof image === "string" && image.trim()) set.image = image.trim();
    if (!Object.keys(set).length) {
      return res.status(400).json({ ok: false, error: "Nothing to update" });
    }

    const channel = serverClient.channel(parsed.channelType, parsed.channelId);
    await channel.updatePartial({ set });

    const actor = actorName || "Someone";
    if (set.name && set.image) {
      await sendGroupSystemMessage(channel, userId, `${actor} updated the group name and photo`);
    } else if (set.name) {
      await sendGroupSystemMessage(channel, userId, `${actor} changed the group name to "${set.name}"`);
    } else if (set.image) {
      await sendGroupSystemMessage(channel, userId, `${actor} changed the group photo`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("GROUP UPDATE ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/group/promote-admin", async (req, res) => {
  try {
    const { channelCid, actorId, targetUserId, actorName } = req.body || {};
    if (!channelCid || !actorId || !targetUserId) {
      return res.status(400).json({
        ok: false,
        error: "channelCid, actorId and targetUserId required",
      });
    }
    const parsed = parseChannelCid(channelCid);
    if (!parsed) {
      return res.status(400).json({ ok: false, error: "Invalid channel id" });
    }

    const state = await queryChannelState(channelCid);
    if (!isGroupAdminFromState(state, actorId)) {
      return res.status(403).json({ ok: false, error: "Only group admins can promote members" });
    }

    const custom = channelCustomData(state);
    const adminIds = adminIdSet(custom);
    adminIds.add(String(targetUserId));
    const channel = serverClient.channel(parsed.channelType, parsed.channelId);

    await channel.assignRoles([
      { user_id: String(targetUserId), channel_role: "channel_moderator" },
    ]);
    await channel.updatePartial({
      set: { admin_ids: Array.from(adminIds), is_group: true },
    });
    await sendGroupSystemMessage(
      channel,
      actorId,
      `${actorName || "A group admin"} made a member an admin`,
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("PROMOTE GROUP ADMIN ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/group/demote-admin", async (req, res) => {
  try {
    const { channelCid, actorId, targetUserId, actorName } = req.body || {};
    if (!channelCid || !actorId || !targetUserId) {
      return res.status(400).json({
        ok: false,
        error: "channelCid, actorId and targetUserId required",
      });
    }
    const parsed = parseChannelCid(channelCid);
    if (!parsed) {
      return res.status(400).json({ ok: false, error: "Invalid channel id" });
    }

    const state = await queryChannelState(channelCid);
    if (!isGroupAdminFromState(state, actorId)) {
      return res.status(403).json({ ok: false, error: "Only group admins can change admin roles" });
    }

    const custom = channelCustomData(state);
    const creatorId = String(custom.created_by_id || "");
    if (creatorId && String(targetUserId) === creatorId) {
      return res.status(403).json({ ok: false, error: "Cannot remove the group creator as admin" });
    }

    const adminIds = adminIdSet(custom);
    adminIds.delete(String(targetUserId));
    const channel = serverClient.channel(parsed.channelType, parsed.channelId);

    await channel.assignRoles([
      { user_id: String(targetUserId), channel_role: "channel_member" },
    ]);
    await channel.updatePartial({
      set: { admin_ids: Array.from(adminIds) },
    });
    await sendGroupSystemMessage(
      channel,
      actorId,
      `${actorName || "A group admin"} removed admin rights from a member`,
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("DEMOTE GROUP ADMIN ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/group/add-members", async (req, res) => {
  try {
    const { channelCid, actorId, memberIds, actorName } = req.body || {};
    if (!channelCid || !actorId || !Array.isArray(memberIds) || !memberIds.length) {
      return res.status(400).json({ ok: false, error: "channelCid, actorId and memberIds required" });
    }
    const parsed = parseChannelCid(channelCid);
    if (!parsed) {
      return res.status(400).json({ ok: false, error: "Invalid channel id" });
    }
    const state = await queryChannelState(channelCid);
    if (!isGroupAdminFromState(state, actorId)) {
      return res.status(403).json({ ok: false, error: "Only group admins can add members" });
    }
    const ids = [...new Set(memberIds.map(String).filter(Boolean))];
    const channel = serverClient.channel(parsed.channelType, parsed.channelId);
    await channel.addMembers(ids, {
      text: `${actorName || "A group admin"} added ${ids.length} member(s)`,
      user_id: actorId,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("GROUP ADD MEMBERS ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/group/remove-member", async (req, res) => {
  try {
    const { channelCid, actorId, targetUserId, actorName } = req.body || {};
    if (!channelCid || !actorId || !targetUserId) {
      return res.status(400).json({ ok: false, error: "channelCid, actorId and targetUserId required" });
    }
    const parsed = parseChannelCid(channelCid);
    if (!parsed) {
      return res.status(400).json({ ok: false, error: "Invalid channel id" });
    }
    const state = await queryChannelState(channelCid);
    if (!isGroupAdminFromState(state, actorId)) {
      return res.status(403).json({ ok: false, error: "Only group admins can remove members" });
    }
    const custom = channelCustomData(state);
    if (String(custom.created_by_id || "") === String(targetUserId)) {
      return res.status(403).json({ ok: false, error: "Cannot remove the group creator" });
    }
    const channel = serverClient.channel(parsed.channelType, parsed.channelId);
    await channel.removeMembers([String(targetUserId)], {
      text: `${actorName || "A group admin"} removed a member`,
      user_id: actorId,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("GROUP REMOVE MEMBER ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
