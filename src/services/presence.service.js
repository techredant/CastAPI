const UserPresence = require("../models/userPresence");

/** User is online if heartbeat was received within this window. */
const ONLINE_WINDOW_MS = Number(process.env.PRESENCE_ONLINE_MS) || 90_000;

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

module.exports = {
  ONLINE_WINDOW_MS,
  heartbeat,
  queryOnlineUserIds,
  allOnlineUserIds,
};
