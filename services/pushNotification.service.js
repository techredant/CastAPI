const { Expo } = require("expo-server-sdk");
const { sendFcmPush, isFcmConfigured } = require("./fcmPush.service");

const expo = new Expo();

const INCOMING_CALL_CHANNEL = "incoming_calls";
const MISSED_CALL_CHANNEL = "missed_calls";
const CHAT_MESSAGES_CHANNEL = "chat_messages";
const LIVE_NOW_CHANNEL = "live_now";
const SOCIAL_CHANNEL = "social";
const FOLLOWERS_CHANNEL = "followers";
const MARKETPLACE_CHANNEL = "marketplace";
const LIVESTREAMS_CHANNEL = "livestreams";
const SYSTEM_CHANNEL = "system_alerts";
const DEFAULT_CHANNEL = "new_cast";

const SOUNDS = {
  default: "notification_sound.wav",
  other: "notification_sound_other.wav",
  incomingCall: "incoming.wav",
};

function soundForPayload(data = {}) {
  const screen = data?.screen;
  const category = data?.category;

  if (screen === "call") return SOUNDS.incomingCall;
  if (screen === "chat" || screen === "missed_call" || category === "messages") {
    return SOUNDS.other;
  }
  if (category === "marketplace") return SOUNDS.other;
  return SOUNDS.default;
}

function channelForPayload(data = {}) {
  const screen = data?.screen;
  const category = data?.category;

  if (screen === "call") return INCOMING_CALL_CHANNEL;
  if (screen === "missed_call") return MISSED_CALL_CHANNEL;
  if (screen === "chat" || category === "messages") return CHAT_MESSAGES_CHANNEL;
  if (screen === "live" || category === "livestreams") return LIVESTREAMS_CHANNEL;
  if (category === "marketplace" || screen === "marketplace") return MARKETPLACE_CHANNEL;
  if (screen === "follow") return FOLLOWERS_CHANNEL;
  if (
    category === "social" ||
    screen === "post" ||
    screen === "mention" ||
    screen === "activity"
  ) {
    return SOCIAL_CHANNEL;
  }
  if (category === "system") return SYSTEM_CHANNEL;
  if (screen === "live") return LIVE_NOW_CHANNEL;
  return DEFAULT_CHANNEL;
}

function streamChannelPath(channelId) {
  const id = String(channelId).includes(":")
    ? String(channelId).split(":").pop()
    : channelId;
  return `/(drawer)/(stream)/channel/${id}`;
}

const sendPushNotification = async (token, title, body, data = {}, options = {}) => {
  const fcmToken = options.fcmToken;
  if (fcmToken && isFcmConfigured()) {
    const fcmResult = await sendFcmPush(fcmToken, title, body, data);
    if (fcmResult.ok) return fcmResult;
  }

  if (!token) return { ok: false };

  if (!Expo.isExpoPushToken(token)) {
    console.warn("Invalid Expo push token:", token);
    return { ok: false, reason: "invalid_token" };
  }

  const screen = data?.screen;
  const channelId = channelForPayload(data);
  const isCall = screen === "call";

  try {
    const sound = soundForPayload(data);
    const message = {
      to: token,
      sound,
      title,
      body,
      data,
      priority: "high",
      /** Deliver to device even if offline briefly (lock screen / home screen). */
      expiration: 86400,
      badge: typeof data.badge === "number" ? data.badge : undefined,
      channelId,
      android: {
        priority: "high",
        channelId,
        sound,
        visibility: "public",
      },
      ios: {
        sound,
        _displayInForeground: true,
      },
      ...(isCall && { _contentAvailable: true }),
      ...(data.actorImage && {
        richContent: {
          image: data.actorImage,
        },
      }),
    };

    const tickets = await expo.sendPushNotificationsAsync([message]);
    const ticket = tickets[0];

    if (ticket?.status === "error") {
      console.error("Push ticket error:", ticket.message, ticket.details);
      return { ok: false, ticket };
    }

    return { ok: true, ticket };
  } catch (err) {
    console.error("sendPushNotification failed:", err.message);
    return { ok: false, error: err.message };
  }
};

async function sendPushToMany(targets, title, body, data = {}) {
  const list = Array.isArray(targets) ? targets : [];
  const normalized = list.map((t) =>
    typeof t === "string"
      ? { expoPushToken: t, fcmToken: null }
      : {
          expoPushToken: t.expoPushToken || null,
          fcmToken: t.fcmToken || null,
        },
  );

  const seen = new Set();
  const unique = normalized.filter((d) => {
    const key = d.fcmToken || d.expoPushToken;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const results = await Promise.allSettled(
    unique.map((device) =>
      sendPushNotification(device.expoPushToken, title, body, data, {
        fcmToken: device.fcmToken,
      }),
    ),
  );
  const sent = results.filter(
    (result) => result.status === "fulfilled" && result.value?.ok,
  ).length;
  return {
    attempted: unique.length,
    sent,
    failed: Math.max(0, unique.length - sent),
    results,
  };
}

/**
 * Legacy helper — routes should migrate to notificationEngine.notify.
 */
const createNotification = async ({
  userId,
  type,
  actor,
  entityId,
  socket,
  pushToken,
  title,
  body,
  io,
}) => {
  const payload = {
    type,
    title:
      title ||
      (type === "follow"
        ? "New follower"
        : type === "mention"
          ? "You were mentioned"
          : "Notification"),
    body:
      body ||
      (actor?.name
        ? `${actor.name} ${type === "follow" ? "started following you" : "sent you an update"}`
        : "You have a new notification"),
    actor,
    entityId,
    createdAt: new Date().toISOString(),
  };

  const emitter = io || socket;
  if (emitter && userId) {
    emitter.to(userId).emit("newNotification", payload);
  }

  if (!pushToken) return;

  const screen =
    type === "live"
      ? "live"
      : type === "follow"
        ? "follow"
        : type === "mention"
          ? "mention"
          : "post";

  const url =
    type === "live" && entityId
      ? `/(drawer)/(live)?callId=${encodeURIComponent(String(entityId))}`
      : type === "follow" && actor?.userId
        ? `/(profileId)/${actor.userId}`
        : "/(drawer)/(tabs)";

  await sendPushNotification(pushToken, payload.title, payload.body, {
    screen,
    type,
    category: type === "follow" ? "social" : "social",
    authorId: actor?.userId,
    postId: type === "post" || type === "mention" ? entityId : undefined,
    callId: type === "live" ? entityId : undefined,
    url,
  });
};

const sendIncomingCallPush = async (
  token,
  title,
  body,
  callId,
  callMode = "video",
) => {
  const fallbackTitle =
    callMode === "audio" ? "Incoming voice call" : "Incoming video call";
  const fallbackBody = `${title || "Someone"} is calling you`;

  await sendPushNotification(
    token,
    title || fallbackTitle,
    body || fallbackBody,
    {
      screen: "call",
      category: "calls",
      type: "incoming_call",
      callId,
      callMode,
      isCaller: "false",
      priority: "high",
    },
  );
};

const sendMissedCallPush = async (token, callerName, callId, callMode = "video") => {
  const label =
    callMode === "audio" ? "Missed voice call" : "Missed video call";

  await sendPushNotification(token, "Missed call", label, {
    screen: "chat",
    category: "calls",
    type: "missed_call",
    channelId: callId,
    url: streamChannelPath(callId),
  });
};

const sendNoAnswerCallPush = async (token, calleeName, channelId) => {
  await sendPushNotification(
    token,
    "No answer",
    calleeName
      ? `${calleeName} didn't answer your call`
      : "Nobody answered your call",
    {
      screen: channelId ? "chat" : "post",
      category: "calls",
      ...(channelId && {
        channelId,
        url: streamChannelPath(channelId),
      }),
    },
  );
};

const sendLiveStartedPush = async (token, hostName, liveTitle, callId) => {
  const title = "Live now";
  const body = liveTitle
    ? `${hostName || "Someone"} is live: ${liveTitle}`
    : `${hostName || "Someone"} started a live broadcast`;

  await sendPushNotification(token, title, body, {
    screen: "live",
    category: "livestreams",
    type: "livestream_started",
    callId,
    url: `/(drawer)/(live)?callId=${encodeURIComponent(String(callId))}`,
  });
};

const sendChatMessagePush = async (
  token,
  senderName,
  preview,
  channelId,
  options = {},
) => {
  const body =
    preview && preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;

  await sendPushNotification(
    token,
    senderName || "New message",
    body || "Sent you a message",
    {
      screen: "chat",
      category: "messages",
      type: options.isGroup ? "group_message" : "message",
      channelId,
      url: streamChannelPath(channelId),
      actorImage: options.actorImage,
      badge: options.badge,
      notificationId: options.notificationId,
    },
  );
};

module.exports = {
  sendPushNotification,
  sendPushToMany,
  createNotification,
  sendIncomingCallPush,
  sendMissedCallPush,
  sendNoAnswerCallPush,
  sendLiveStartedPush,
  sendChatMessagePush,
  INCOMING_CALL_CHANNEL,
  MISSED_CALL_CHANNEL,
  CHAT_MESSAGES_CHANNEL,
  LIVE_NOW_CHANNEL,
  SOCIAL_CHANNEL,
  FOLLOWERS_CHANNEL,
  MARKETPLACE_CHANNEL,
  LIVESTREAMS_CHANNEL,
  SYSTEM_CHANNEL,
};
