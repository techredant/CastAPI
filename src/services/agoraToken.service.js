const { RtcTokenBuilder, RtcRole } = require("agora-token");

const APP_ID = process.env.AGORA_APP_ID || "";
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || "";

const TOKEN_TTL = {
  call: 3600,
  liveHost: 4 * 3600,
  liveViewer: 1800,
  liveGuest: 3600,
};

function requireAgoraConfig() {
  if (!APP_ID || !APP_CERTIFICATE) {
    throw new Error("AGORA_APP_ID and AGORA_APP_CERTIFICATE must be configured");
  }
}

function clerkIdToUid(clerkId) {
  let hash = 0;
  const str = String(clerkId || "0");
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 2147483646 + 1;
}

function resolveRole(role) {
  if (role === "subscriber" || role === "audience") {
    return RtcRole.SUBSCRIBER;
  }
  return RtcRole.PUBLISHER;
}

function resolveTtl(context) {
  if (context === "liveHost") return TOKEN_TTL.liveHost;
  if (context === "liveViewer") return TOKEN_TTL.liveViewer;
  if (context === "liveGuest") return TOKEN_TTL.liveGuest;
  return TOKEN_TTL.call;
}

/**
 * Build an Agora RTC token for channel join.
 * @param {{ channelName: string, uid?: number|string, role?: string, context?: string }} opts
 */
function buildRtcToken({
  channelName,
  uid,
  role = "publisher",
  context = "call",
}) {
  requireAgoraConfig();

  if (!channelName || typeof channelName !== "string") {
    throw new Error("channelName is required");
  }

  const numericUid =
    typeof uid === "number" && uid > 0
      ? uid
      : typeof uid === "string" && /^\d+$/.test(uid)
        ? Number(uid)
        : 0;

  const expireSeconds = resolveTtl(context);
  const privilegeExpire = Math.floor(Date.now() / 1000) + expireSeconds;
  const agoraRole = resolveRole(role);

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    numericUid,
    agoraRole,
    privilegeExpire,
    privilegeExpire,
  );

  return {
    token,
    appId: APP_ID,
    uid: numericUid,
    channelName,
    role,
    expireSeconds,
  };
}

function getPublicAppId() {
  return APP_ID || null;
}

module.exports = {
  buildRtcToken,
  clerkIdToUid,
  getPublicAppId,
  TOKEN_TTL,
};
