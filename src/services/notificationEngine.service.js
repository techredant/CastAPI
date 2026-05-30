const Notification = require("../models/notification");
const DeviceToken = require("../models/deviceToken");
const NotificationPreference = require("../models/notificationPreference");
const User = require("../models/user");
const {
  sendPushNotification,
  sendPushToMany,
} = require("../../services/pushNotification.service");

const GROUPABLE_TYPES = new Set([
  "like",
  "comment",
  "reply",
  "mention",
  "repost",
  "share",
  "story_reaction",
  "message",
  "group_message",
  "live_reaction",
  "product_like",
]);

function buildGroupKey({ type, entityId, actorId, userId }) {
  if (!GROUPABLE_TYPES.has(type)) return null;
  return `${userId}:${type}:${entityId || "none"}:${actorId || "none"}`;
}

function buildDedupeKey({ userId, type, entityId, actorId, dedupeWindowMs }) {
  if (!dedupeWindowMs) return null;
  const bucket = Math.floor(Date.now() / dedupeWindowMs);
  return `${userId}:${type}:${entityId || ""}:${actorId || ""}:${bucket}`;
}

function deepLinkForNotification({ type, entityId, actor, data = {} }) {
  if (data.url) return data;

  const actorId = actor?.userId || data.authorId;

  if (type === "livestream_started" || data.screen === "live") {
    return {
      screen: "live",
      callId: entityId || data.callId,
      url: entityId
        ? `/(drawer)/(live)?callId=${encodeURIComponent(String(entityId))}`
        : "/(drawer)/(live)",
    };
  }

  if (
    type === "message" ||
    type === "group_message" ||
    type === "media_message" ||
    type === "voice_note" ||
    data.screen === "chat"
  ) {
    const channelId = data.channelId || entityId;
    const id = String(channelId || "").includes(":")
      ? String(channelId).split(":").pop()
      : channelId;
    return {
      screen: "chat",
      channelId,
      url: id ? `/(drawer)/(stream)/channel/${id}` : "/(drawer)/(stream)",
    };
  }

  if (type === "incoming_call" || type === "missed_call" || data.screen === "call") {
    return {
      screen: "call",
      callId: data.callId || entityId,
      callMode: data.callMode || "video",
      isCaller: data.isCaller || "false",
      url: data.callId
        ? `/(drawer)/(stream)/call/${data.callId}?isCaller=false&callMode=${data.callMode || "video"}`
        : "/(drawer)/(stream)",
    };
  }

  if (type === "follow" || data.screen === "follow") {
    return {
      screen: "follow",
      category: "social",
      authorId: actorId,
      url: actorId ? `/(profileId)/${actorId}` : "/(drawer)/(tabs)",
    };
  }

  if (
    type === "share" ||
    type === "repost" ||
    data.screen === "post" ||
    data.screen === "feed"
  ) {
    return {
      screen: "post",
      category: "social",
      postId: entityId || data.postId,
      authorId: actorId,
      url: "/(drawer)/(tabs)",
    };
  }

  if (type === "mention" || type === "comment" || type === "reply" || type === "like") {
    return {
      screen: type === "mention" ? "mention" : "post",
      category: "social",
      postId: entityId || data.postId,
      authorId: actorId,
      url: "/(drawer)/(tabs)",
    };
  }

  if (
    type === "new_order" ||
    type === "order_update" ||
    type === "delivery_update" ||
    type === "product_like" ||
    type === "seller_response"
  ) {
    return {
      screen: "marketplace",
      entityId,
      url: entityId
        ? `/(drawer)/(market)/product/${entityId}`
        : "/(drawer)/(market)",
    };
  }

  if (type === "verification_approved") {
    return { screen: "verification", url: "/(drawer)/verification" };
  }

  return {
    screen: "activity",
    url: "/(drawer)/(drawerPages)/ActivityInbox",
  };
}

function isQuietHours(prefs) {
  if (!prefs?.quietHours?.enabled) return false;

  const now = new Date();
  const [startH, startM] = (prefs.quietHours.start || "22:00")
    .split(":")
    .map(Number);
  const [endH, endM] = (prefs.quietHours.end || "07:00").split(":").map(Number);

  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;

  if (start <= end) {
    return minutes >= start && minutes < end;
  }
  return minutes >= start || minutes < end;
}

async function getPreferences(userId) {
  let prefs = await NotificationPreference.findOne({ userId });
  if (!prefs) {
    prefs = await NotificationPreference.create({ userId });
  }
  return prefs;
}

async function getUnreadCount(userId) {
  return Notification.countDocuments({ userId, read: false });
}

async function getActiveTokens(userId) {
  const devices = await DeviceToken.find({ userId, active: true }).lean();
  if (devices.length) {
    return devices
      .map((d) => ({
        expoPushToken: d.expoPushToken || null,
        fcmToken: d.fcmToken || null,
      }))
      .filter((d) => d.expoPushToken || d.fcmToken);
  }

  const user = await User.findOne({ clerkId: userId })
    .select("expoPushToken")
    .lean();
  return user?.expoPushToken
    ? [{ expoPushToken: user.expoPushToken, fcmToken: null }]
    : [];
}

async function emitToUser(io, userId, event, payload) {
  if (!io || !userId) return;
  io.to(userId).emit(event, payload);
}

async function notify({
  userId,
  type,
  title,
  body,
  actor,
  entityId,
  entityType,
  mediaPreview,
  data = {},
  io,
  skipPush = false,
  skipPersist = false,
  dedupeWindowMs = null,
  groupWindowMs = 5 * 60 * 1000,
}) {
  if (!userId) return null;

  const category = Notification.categoryForType(type);
  const prefs = await getPreferences(userId);

  if (actor?.userId && prefs.mutedUsers?.includes(actor.userId)) {
    return null;
  }

  if (entityId && prefs.mutedGroups?.includes(String(entityId))) {
    return null;
  }

  if (prefs.enabled?.[category] === false) {
    skipPush = true;
  }

  const actorId = actor?.userId || null;
  const groupKey = buildGroupKey({ type, entityId, actorId, userId });
  const dedupeKey = buildDedupeKey({
    userId,
    type,
    entityId,
    actorId,
    dedupeWindowMs,
  });

  const linkData = deepLinkForNotification({ type, entityId, actor, data });
  const mergedData = { ...linkData, ...data, type, category };

  let notification = null;

  if (!skipPersist) {
    if (dedupeKey) {
      const existing = await Notification.findOne({ dedupeKey });
      if (existing) {
        notification = existing;
      }
    }

    if (groupKey && GROUPABLE_TYPES.has(type)) {
      const since = new Date(Date.now() - groupWindowMs);
      const grouped = await Notification.findOne({
        userId,
        groupKey,
        read: false,
        createdAt: { $gte: since },
      }).sort({ createdAt: -1 });

      if (grouped) {
        grouped.groupCount = (grouped.groupCount || 1) + 1;
        grouped.body = body || grouped.body;
        grouped.title = title || grouped.title;
        grouped.updatedAt = new Date();
        await grouped.save();
        notification = grouped;
      }
    }

    if (!notification) {
      try {
        notification = await Notification.create({
          userId,
          type,
          category,
          title,
          body: body || "",
          actor,
          entityId: entityId || null,
          entityType: entityType || null,
          mediaPreview: mediaPreview || null,
          groupKey,
          groupCount: 1,
          data: mergedData,
          dedupeKey,
        });
      } catch (err) {
        if (err?.code === 11000 && dedupeKey) {
          notification = await Notification.findOne({ dedupeKey });
        } else {
          throw err;
        }
      }
    }
  }

  const payload = notification
    ? {
        _id: notification._id.toString(),
        type: notification.type,
        category: notification.category,
        title: notification.title,
        body: notification.body,
        actor: notification.actor,
        entityId: notification.entityId,
        entityType: notification.entityType,
        mediaPreview: notification.mediaPreview,
        groupCount: notification.groupCount,
        read: notification.read,
        data: notification.data,
        createdAt: notification.createdAt,
      }
    : {
        type,
        category,
        title,
        body,
        actor,
        entityId,
        entityType,
        mediaPreview,
        groupCount: 1,
        read: false,
        data: mergedData,
        createdAt: new Date().toISOString(),
      };

  await emitToUser(io, userId, "newNotification", payload);

  const unreadCount = await getUnreadCount(userId);
  await emitToUser(io, userId, "unreadCountUpdated", { unreadCount });

  const quiet = isQuietHours(prefs);
  const isCall = type === "incoming_call";

  if (!skipPush && (!quiet || isCall)) {
    const tokens = await getActiveTokens(userId);
    const needsPush = !notification?.pushSent;

    if (tokens.length && needsPush) {
      const pushResult = await sendPushToMany(tokens, title, body, {
        ...mergedData,
        notificationId: payload._id,
        badge: unreadCount,
        actorImage: actor?.image,
        mediaPreview,
      });

      if (notification && pushResult.sent > 0) {
        notification.pushSent = true;
        await notification.save();
      } else if (!pushResult.sent) {
        console.warn(
          `[notify] Push failed for user ${userId} (${type}) — ${pushResult.attempted} device(s) attempted`,
        );
      }
    } else if (!tokens.length) {
      console.warn(
        `[notify] No push token for user ${userId} (${type}) — enable notifications in app`,
      );
    }
  }

  return notification;
}

async function markRead(userId, notificationId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { read: true, readAt: new Date() },
    { new: true },
  );
  return notification;
}

async function markAllRead(userId, category = null) {
  const filter = { userId, read: false };
  if (category && category !== "all") {
    filter.category = category;
  }

  await Notification.updateMany(filter, {
    read: true,
    readAt: new Date(),
  });
}

async function deleteNotification(userId, notificationId) {
  return Notification.findOneAndDelete({ _id: notificationId, userId });
}

module.exports = {
  notify,
  markRead,
  markAllRead,
  deleteNotification,
  getPreferences,
  getUnreadCount,
  getActiveTokens,
  buildGroupKey,
  deepLinkForNotification,
};
