const express = require("express");
const Notification = require("../models/notification");
const DeviceToken = require("../models/deviceToken");
const NotificationPreference = require("../models/notificationPreference");
const User = require("../models/user");
const {
  notify,
  markRead,
  markAllRead,
  deleteNotification,
  getPreferences,
  getUnreadCount,
} = require("../services/notificationEngine.service");
const { getFcmStatus } = require("../../services/fcmPush.service");

module.exports = function notificationsRoutes(io) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const { userId, category = "all", cursor, limit = 30 } = req.query;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const filter = { userId };
      if (category && category !== "all") {
        filter.category = category;
      }

      if (cursor) {
        filter.createdAt = { $lt: new Date(cursor) };
      }

      const notifications = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(limit) || 30, 50))
        .lean();

      const unreadCount = await getUnreadCount(userId);

      res.json({
        notifications,
        unreadCount,
        nextCursor:
          notifications.length > 0
            ? notifications[notifications.length - 1].createdAt
            : null,
      });
    } catch (err) {
      console.error("GET /notifications:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.get("/unread-count", async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const unreadCount = await getUnreadCount(userId);
      res.json({ unreadCount });
    } catch (err) {
      console.error("GET /notifications/unread-count:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.get("/push/status", async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const devices = await DeviceToken.find({ userId, active: true }).lean();
      const fcmStatus = getFcmStatus();

      res.json({
        fcm: fcmStatus,
        activeDevices: devices.length,
        fcmTokens: devices.filter((d) => Boolean(d.fcmToken)).length,
        expoTokens: devices.filter((d) => Boolean(d.expoPushToken)).length,
        devices: devices.map((device) => ({
          deviceId: device.deviceId,
          platform: device.platform,
          hasFcmToken: Boolean(device.fcmToken),
          hasExpoPushToken: Boolean(device.expoPushToken),
          lastSeenAt: device.lastSeenAt,
        })),
      });
    } catch (err) {
      console.error("GET /notifications/push/status:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/push/test", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const notification = await notify({
        userId,
        type: "system",
        title: "BroadCast test notification",
        body: "If you can see this outside the app, push is working.",
        entityType: "system",
        data: {
          screen: "activity",
          category: "system",
        },
        io,
        dedupeWindowMs: 0,
      });

      res.json({
        ok: true,
        notificationId: notification?._id?.toString?.() ?? null,
        fcm: getFcmStatus(),
      });
    } catch (err) {
      console.error("POST /notifications/push/test:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.patch("/:id/read", async (req, res) => {
    try {
      const { userId } = req.body;
      const { id } = req.params;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const notification = await markRead(userId, id);
      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }

      const unreadCount = await getUnreadCount(userId);
      io.to(userId).emit("notificationUpdated", {
        _id: notification._id.toString(),
        read: true,
      });
      io.to(userId).emit("unreadCountUpdated", { unreadCount });

      res.json({ notification, unreadCount });
    } catch (err) {
      console.error("PATCH /notifications/:id/read:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.patch("/read-all", async (req, res) => {
    try {
      const { userId, category = "all" } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      await markAllRead(userId, category);
      const unreadCount = await getUnreadCount(userId);

      io.to(userId).emit("notificationsReadAll", { category });
      io.to(userId).emit("unreadCountUpdated", { unreadCount });

      res.json({ success: true, unreadCount });
    } catch (err) {
      console.error("PATCH /notifications/read-all:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const { userId } = req.query;
      const { id } = req.params;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const deleted = await deleteNotification(userId, id);
      if (!deleted) {
        return res.status(404).json({ message: "Notification not found" });
      }

      const unreadCount = await getUnreadCount(userId);
      io.to(userId).emit("notificationDeleted", { _id: id });
      io.to(userId).emit("unreadCountUpdated", { unreadCount });

      res.json({ success: true, unreadCount });
    } catch (err) {
      console.error("DELETE /notifications/:id:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.get("/preferences", async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const preferences = await getPreferences(userId);
      res.json({ preferences });
    } catch (err) {
      console.error("GET /notifications/preferences:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.patch("/preferences", async (req, res) => {
    try {
      const { userId, ...updates } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const preferences = await NotificationPreference.findOneAndUpdate(
        { userId },
        { $set: updates },
        { new: true, upsert: true },
      );

      res.json({ preferences });
    } catch (err) {
      console.error("PATCH /notifications/preferences:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.post("/device/register", async (req, res) => {
    try {
      const {
        userId,
        deviceId,
        token,
        fcmToken,
        platform = "unknown",
        appVersion,
        osVersion,
        deviceName,
      } = req.body;

      if (!userId || !deviceId || (!token && !fcmToken)) {
        return res.status(400).json({
          message: "userId, deviceId, and token or fcmToken are required",
        });
      }

      const update = {
        platform,
        appVersion,
        osVersion,
        deviceName,
        active: true,
        lastSeenAt: new Date(),
      };
      if (token) update.expoPushToken = token;
      if (fcmToken) update.fcmToken = fcmToken;

      const device = await DeviceToken.findOneAndUpdate(
        { userId, deviceId },
        update,
        { upsert: true, new: true },
      );

      if (token) {
        await User.findOneAndUpdate(
          { clerkId: userId },
          { expoPushToken: token },
          { new: true },
        );
      }

      res.json({ success: true, device });
    } catch (err) {
      console.error("POST /notifications/device/register:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.delete("/device/:deviceId", async (req, res) => {
    try {
      const { userId } = req.query;
      const { deviceId } = req.params;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      await DeviceToken.findOneAndUpdate(
        { userId, deviceId },
        { active: false },
      );

      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /notifications/device:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** Legacy token endpoint — kept for backwards compatibility */
  router.post("/token", async (req, res) => {
    try {
      const { userId, token, fcmToken, deviceId, platform } = req.body;

      if (!userId || (!token && !fcmToken)) {
        return res.status(400).json({ message: "Missing userId or token/fcmToken" });
      }

      const resolvedDeviceId = deviceId || `legacy-${userId}`;

      const legacyUpdate = {
        platform: platform || "unknown",
        active: true,
        lastSeenAt: new Date(),
      };
      if (token) legacyUpdate.expoPushToken = token;
      if (fcmToken) legacyUpdate.fcmToken = fcmToken;

      await DeviceToken.findOneAndUpdate(
        { userId, deviceId: resolvedDeviceId },
        legacyUpdate,
        { upsert: true, new: true },
      );

      const user = await User.findOneAndUpdate(
        { clerkId: userId },
        { expoPushToken: token },
        { new: true },
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found — complete profile setup first",
          clerkId: userId,
        });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("notification-token:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.notify = notify;

  return router;
};
