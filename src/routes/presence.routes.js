const express = require("express");
const {
  heartbeat,
  queryPresenceForUserIds,
} = require("../services/presence.service");

module.exports = function presenceRoutes() {
  const router = express.Router();

  /** POST /api/presence/heartbeat — client ping (Vercel-safe). */
  router.post("/heartbeat", async (req, res) => {
    try {
      const userId = req.body?.userId;
      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ message: "userId required" });
      }
      const lastSeenAt = await heartbeat(userId);
      return res.status(200).json({ ok: true, lastSeenAt });
    } catch (err) {
      console.error("presence heartbeat:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/presence/query — batch online check for avatars in feed, chat, etc. */
  router.post("/query", async (req, res) => {
    try {
      const userIds = req.body?.userIds;
      if (!Array.isArray(userIds)) {
        return res.status(400).json({ message: "userIds array required" });
      }
      const result = await queryPresenceForUserIds(userIds);
      return res.status(200).json(result);
    } catch (err) {
      console.error("presence query:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
