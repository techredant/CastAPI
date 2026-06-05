const UserPresence = require("../models/userPresence");

/** User is online if heartbeat was received within this window. */
const ONLINE_WINDOW_MS = Number(process.env.PRESENCE_ONLINE_MS) || 90_000;

/** Gray "recently left" dot — lastSeen within this window but outside online window. */
const RECENT_OFFLINE_MS = Number(process.env.PRESENCE_RECENT_MS) || 5 * 60_000;

async function heartbeat(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;

  const now = new Date();
  await UserPresence.findOneAndUpdate(
    { userId: id },
    { userId: id, lastSeenAt: now },
    { upsert: true, new: true },
  );
  return now;
}

async function queryOnlineUserIds(userIds) {
  const ids = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const rows = await UserPresence.find({
    userId: { $in: ids },
    lastSeenAt: { $gte: cutoff },
  })
    .select("userId")
    .lean();

  return rows.map((row) => row.userId);
}

async function allOnlineUserIds() {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const rows = await UserPresence.find({ lastSeenAt: { $gte: cutoff } })
    .select("userId")
    .lean();
  return rows.map((row) => row.userId);
}

/**
 * Batch presence for avatars: online (green) vs recently seen (gray) vs hidden.
 * Only users with a row in the recent window are returned in `users`.
 */
async function queryPresenceForUserIds(userIds) {
  const ids = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))];
  if (ids.length === 0) {
    return {
      onlineUserIds: [],
      users: [],
      windowMs: ONLINE_WINDOW_MS,
      recentWindowMs: RECENT_OFFLINE_MS,
    };
  }

  const now = Date.now();
  const onlineCutoff = new Date(now - ONLINE_WINDOW_MS);
  const recentCutoff = new Date(now - RECENT_OFFLINE_MS);
  const rows = await UserPresence.find({
    userId: { $in: ids },
    lastSeenAt: { $gte: recentCutoff },
  })
    .select("userId lastSeenAt")
    .lean();

  const onlineUserIds = [];
  const users = rows.map((row) => {
    const lastSeenAt = row.lastSeenAt;
    if (lastSeenAt >= onlineCutoff) onlineUserIds.push(row.userId);
    return {
      userId: row.userId,
      lastSeenAt: lastSeenAt.toISOString(),
    };
  });

  return {
    onlineUserIds,
    users,
    windowMs: ONLINE_WINDOW_MS,
    recentWindowMs: RECENT_OFFLINE_MS,
  };
}

module.exports = {
  ONLINE_WINDOW_MS,
  RECENT_OFFLINE_MS,
  heartbeat,
  queryOnlineUserIds,
  queryPresenceForUserIds,
  allOnlineUserIds,
};
