/**
 * Firebase Cloud Messaging (high priority) — used when devices register fcmToken.
 * Set FIREBASE_SERVICE_ACCOUNT_JSON to the service account JSON string.
 */
let firebaseAdmin = null;

function getMessaging() {
  if (firebaseAdmin === false) return null;

  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
      ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
      : null);
  if (!raw) {
    firebaseAdmin = false;
    return null;
  }

  try {
    if (!firebaseAdmin) {
      const admin = require("firebase-admin");
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(JSON.parse(raw)),
        });
      }
      firebaseAdmin = admin;
    }
    return firebaseAdmin.messaging();
  } catch (err) {
    console.error("[FCM] init failed:", err.message);
    firebaseAdmin = false;
    return null;
  }
}

function stringifyData(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

function channelForPayload(data = {}) {
  const screen = data?.screen;
  const category = data?.category;
  const type = data?.type;

  if (screen === "call" || type === "incoming_call") return "incoming_calls";
  if (screen === "missed_call") return "missed_calls";
  if (screen === "chat" || category === "messages") return "chat_messages";
  if (screen === "live" || category === "livestreams") return "livestreams";
  if (screen === "follow" || type === "follow") return "followers";
  if (category === "marketplace") return "marketplace";
  if (category === "system") return "system_alerts";
  return "new_cast";
}

function getFcmStatus() {
  const hasCredentials = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
  );
  return {
    configured: Boolean(getMessaging()),
    hasCredentials,
  };
}

/**
 * Data-first FCM so the app renders with Notifee (heads-up, full-screen calls, grouping).
 */
async function sendFcmPush(fcmToken, title, body, data = {}) {
  const messaging = getMessaging();
  if (!messaging || !fcmToken) {
    return { ok: false, reason: "fcm_not_configured" };
  }

  const channelId = channelForPayload(data);

  const payload = stringifyData({
    ...data,
    title,
    body,
    channelId,
  });

  try {
    const messageId = await messaging.send({
      token: fcmToken,
      data: payload,
      android: {
        priority: "high",
        ttl: 86400 * 1000,
        directBootOk: true,
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            alert: { title, body },
            sound: "default",
            badge: data.badge ? Number(data.badge) : undefined,
            "content-available": 1,
          },
        },
      },
    });

    return { ok: true, messageId };
  } catch (err) {
    console.error("[FCM] send failed:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  sendFcmPush,
  getMessaging,
  getFcmStatus,
  isFcmConfigured: () => Boolean(getMessaging()),
};
