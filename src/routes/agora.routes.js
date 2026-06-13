const express = require("express");
const CallSession = require("../models/callSession");
const Livestream = require("../models/livestream");
const LiveEvent = require("../models/liveEvent");
const User = require("../models/user");
const {
  buildRtcToken,
  clerkIdToUid,
  getPublicAppId,
} = require("../services/agoraToken.service");
const { ensureMissedCallChatMessage } = require("../services/callChatMessages.service");
const { notify } = require("../services/notificationEngine.service");
const {
  sendMissedCallPush,
  sendNoAnswerCallPush,
} = require("../../services/pushNotification.service");

function displayNameFromDbUser(user) {
  if (!user) return null;
  if (user.nickName?.trim()) return user.nickName.trim();
  const full = `${user.firstName || ""} ${user.lastName || ""}`.trim();
  if (full) return full;
  if (user.companyName?.trim()) return user.companyName.trim();
  return null;
}

async function hostNamesByClerkIds(clerkIds) {
  const unique = [...new Set(clerkIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const users = await User.find({ clerkId: { $in: unique } }).lean();
  const map = new Map();
  for (const user of users) {
    map.set(user.clerkId, displayNameFromDbUser(user) || "Member");
  }
  return map;
}

function liveRoom(callId) {
  return `live:${callId}`;
}

function emitToUser(io, userId, event, payload) {
  if (!io || !userId) return;
  io.to(String(userId)).emit(event, payload);
}

function emitToLive(io, callId, event, payload) {
  if (!io || !callId) return;
  io.to(liveRoom(callId)).emit(event, payload);
}

function resolveLiveEventId(payload = {}) {
  return (
    payload.messageId ||
    payload.reactionId ||
    payload.giftEventId ||
    payload.donationEventId ||
    `${payload.senderId || payload.userId || "anon"}:${payload.type || "event"}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`
  );
}

async function persistLiveEvent(callId, eventType, payload) {
  if (!callId || !eventType) return;
  const flat = { callId, ...payload };
  const eventId = resolveLiveEventId(flat);
  try {
    await LiveEvent.create({
      callId,
      eventType,
      eventId,
      payload: flat,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
}

const STALE_RING_MS = 90 * 1000;

async function resolveBlockingCallSession(channelName, callerId) {
  const existing = await CallSession.findOne({
    channelName,
    status: { $in: ["ringing", "active"] },
  });
  if (!existing) return null;

  const updatedAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
  const ageMs = Date.now() - updatedAt;
  const isStaleRing =
    existing.status === "ringing" && ageMs > STALE_RING_MS;
  const sameCallerRetry = existing.callerId === callerId;

  if (isStaleRing || sameCallerRetry) {
    await CallSession.findOneAndUpdate(
      { channelName },
      {
        status: "ended",
        endedReason: isStaleRing ? "timeout" : "superseded",
        endedAt: new Date(),
      },
    );
    return null;
  }

  return existing;
}

module.exports = (io) => {
  const router = express.Router();

  router.get("/app-id", (_req, res) => {
    const appId = getPublicAppId();
    if (!appId) {
      return res.status(503).json({ ok: false, error: "Agora not configured" });
    }
    return res.json({ ok: true, appId });
  });

  router.post("/token", async (req, res) => {
    try {
      const { channelName, role, uid, userId, context } = req.body;
      if (!channelName) {
        return res.status(400).json({ ok: false, error: "channelName required" });
      }

      const resolvedUid =
        typeof uid === "number"
          ? uid
          : userId
            ? clerkIdToUid(userId)
            : 0;

      const result = buildRtcToken({
        channelName: String(channelName),
        uid: resolvedUid,
        role: role || "publisher",
        context: context || "call",
      });

      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("agora token error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/calls/invite", async (req, res) => {
    try {
      const {
        channelName,
        callerId,
        memberIds,
        callMode = "video",
        channelCid,
        callerName,
        callerImage,
      } = req.body;

      if (!channelName || !callerId || !Array.isArray(memberIds)) {
        return res.status(400).json({ ok: false, error: "Invalid invite payload" });
      }

      const recipients = memberIds.filter((id) => id && id !== callerId);
      if (recipients.length === 0) {
        return res.status(400).json({ ok: false, error: "No recipients" });
      }

      const existing = await resolveBlockingCallSession(channelName, callerId);
      if (existing) {
        return res.status(409).json({ ok: false, error: "Call already in progress" });
      }

      await CallSession.findOneAndUpdate(
        { channelName },
        {
          channelName,
          callerId,
          memberIds: [...new Set([callerId, ...memberIds])],
          callMode: callMode === "audio" ? "audio" : "video",
          channelCid: channelCid || "",
          status: "ringing",
          acceptedBy: [],
          endedReason: "",
          endedAt: null,
        },
        { upsert: true, new: true },
      );

      const callerLabel =
        callerName ||
        displayNameFromDbUser(await User.findOne({ clerkId: callerId })) ||
        "Someone";

      const ringPayload = {
        channelName,
        callerId,
        callerName: callerLabel,
        callerImage: callerImage || null,
        callMode: callMode === "audio" ? "audio" : "video",
        channelCid: channelCid || null,
        memberIds: [...new Set([callerId, ...memberIds])],
        rungAt: new Date().toISOString(),
      };

      for (const userId of recipients) {
        emitToUser(io, userId, "call:ring", ringPayload);
        await notify({
          userId,
          type: "incoming_call",
          title: callerLabel,
          body: `${callerLabel} is calling you`,
          actor: {
            userId: callerId,
            name: callerLabel,
            image: callerImage,
          },
          entityId: channelName,
          entityType: "call",
          data: {
            screen: "call",
            category: "calls",
            callId: channelName,
            callMode: ringPayload.callMode,
            isCaller: "false",
            channelId: channelName,
          },
          io,
          skipPersist: true,
        });
      }

      return res.json({ ok: true, channelName, recipients });
    } catch (err) {
      console.error("call invite error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/calls/accept", async (req, res) => {
    try {
      const { channelName, userId } = req.body;
      if (!channelName || !userId) {
        return res.status(400).json({ ok: false, error: "channelName and userId required" });
      }

      const session = await CallSession.findOneAndUpdate(
        { channelName, status: { $in: ["ringing", "active"] } },
        {
          status: "active",
          $addToSet: { acceptedBy: userId },
        },
        { new: true },
      );

      if (!session) {
        return res.status(404).json({ ok: false, error: "Call not found" });
      }

      const payload = { channelName, userId, callMode: session.callMode };
      emitToUser(io, session.callerId, "call:accepted", payload);
      for (const memberId of session.memberIds) {
        if (memberId !== userId) {
          emitToUser(io, memberId, "call:accepted", payload);
        }
      }

      return res.json({ ok: true, session });
    } catch (err) {
      console.error("call accept error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/calls/decline", async (req, res) => {
    try {
      const { channelName, userId, reason = "decline" } = req.body;
      if (!channelName || !userId) {
        return res.status(400).json({ ok: false, error: "channelName and userId required" });
      }

      const session = await CallSession.findOne({
        channelName,
        status: { $in: ["ringing", "active"] },
      });

      if (!session) {
        return res.json({ ok: true, alreadyEnded: true });
      }

      const isCaller = session.callerId === userId;
      const callMode = session.callMode || "video";

      await CallSession.findOneAndUpdate(
        { channelName },
        {
          status: "ended",
          endedReason: reason,
          endedAt: new Date(),
        },
      );

      const payload = { channelName, userId, reason, callMode };

      if (reason === "decline" && !isCaller) {
        await ensureMissedCallChatMessage(channelName, session.callerId, callMode);
        emitToUser(io, session.callerId, "call:declined", payload);
      } else if (reason === "cancel" && isCaller) {
        await ensureMissedCallChatMessage(channelName, session.callerId, callMode);
        for (const memberId of session.memberIds) {
          if (memberId !== userId) {
            emitToUser(io, memberId, "call:declined", payload);
          }
        }
      } else if (reason === "busy") {
        emitToUser(io, session.callerId, "call:busy", payload);
      } else {
        for (const memberId of session.memberIds) {
          emitToUser(io, memberId, "call:declined", payload);
        }
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("call decline error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/calls/end", async (req, res) => {
    try {
      const { channelName, userId, reason = "hangup" } = req.body;
      if (!channelName) {
        return res.status(400).json({ ok: false, error: "channelName required" });
      }

      const session = await CallSession.findOneAndUpdate(
        { channelName, status: { $in: ["ringing", "active"] } },
        {
          status: "ended",
          endedReason: reason,
          endedAt: new Date(),
        },
        { new: true },
      );

      const payload = { channelName, userId, reason };
      if (session) {
        for (const memberId of session.memberIds) {
          emitToUser(io, memberId, "call:ended", payload);
        }
      } else {
        emitToLive(io, channelName, "call:ended", payload);
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("call end error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get("/calls/session/:channelName", async (req, res) => {
    try {
      const session = await CallSession.findOne({
        channelName: req.params.channelName,
      }).lean();
      return res.json({ ok: true, session });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get("/calls/incoming/:userId", async (req, res) => {
    try {
      const userId = String(req.params.userId || "").trim();
      if (!userId) {
        return res.status(400).json({ ok: false, error: "userId required" });
      }

      const sessions = await CallSession.find({
        status: "ringing",
        memberIds: userId,
        callerId: { $ne: userId },
        acceptedBy: { $nin: [userId] },
      })
        .sort({ updatedAt: -1 })
        .limit(3)
        .lean();

      const callerIds = [...new Set(sessions.map((s) => s.callerId).filter(Boolean))];
      const callers = callerIds.length
        ? await User.find({ clerkId: { $in: callerIds } })
            .select("clerkId firstName lastName companyName nickName image")
            .lean()
        : [];
      const callerById = new Map(callers.map((u) => [u.clerkId, u]));

      const rings = sessions.map((session) => {
        const caller = callerById.get(session.callerId);
        const callerName =
          displayNameFromDbUser(caller) || "Someone";
        return {
          channelName: session.channelName,
          callerId: session.callerId,
          callerName,
          callerImage: caller?.image || null,
          callMode: session.callMode === "audio" ? "audio" : "video",
          channelCid: session.channelCid || null,
          memberIds: session.memberIds || [],
          rungAt: session.updatedAt?.toISOString?.() || new Date().toISOString(),
        };
      });

      return res.json({ ok: true, rings });
    } catch (err) {
      console.error("incoming calls poll error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/live/start", async (req, res) => {
    try {
      const {
        callId,
        hostClerkId,
        variant = "community",
        roomTitle,
        level,
        custom = {},
      } = req.body;

      if (!callId || !hostClerkId) {
        return res.status(400).json({ ok: false, error: "callId and hostClerkId required" });
      }

      const streamKind =
        variant === "market" ? "market" : variant === "audio" ? "audio" : "community";

      const hostUser = await User.findOne({ clerkId: hostClerkId }).lean();
      const hostDisplayName = displayNameFromDbUser(hostUser) || "Member";

      await Livestream.findOneAndUpdate(
        { callId },
        {
          callId,
          hostUserId: hostClerkId,
          hostDisplayName,
          title: roomTitle || custom.title || "Live",
          streamKind,
          status: "live",
          startedAt: new Date(),
          endedAt: null,
          viewerCount: 0,
          county: level || custom.level || "",
        },
        { upsert: true, new: true },
      );

      const payload = {
        callId,
        hostClerkId,
        hostName: hostDisplayName,
        variant,
        roomTitle: roomTitle || custom.title || "Live",
        level: level || custom.level,
        custom,
      };

      io.emit("live:started", payload);
      emitToLive(io, callId, "live:started", payload);

      return res.json({ ok: true, ...payload });
    } catch (err) {
      console.error("live start error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/live/end", async (req, res) => {
    try {
      const { callId, hostClerkId } = req.body;
      if (!callId) {
        return res.status(400).json({ ok: false, error: "callId required" });
      }

      await Livestream.findOneAndUpdate(
        { callId },
        {
          status: "ended",
          endedAt: new Date(),
        },
      );

      const payload = { callId, hostClerkId };
      await persistLiveEvent(callId, "live:ended", payload);
      io.emit("live:ended", payload);
      emitToLive(io, callId, "live:ended", payload);

      return res.json({ ok: true });
    } catch (err) {
      console.error("live end error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get("/live/active", async (req, res) => {
    try {
      const { variant, hostClerkId, includeEnded } = req.query;
      const filter = { status: "live" };
      if (variant === "market") filter.streamKind = "market";
      else if (variant === "community") filter.streamKind = "community";
      else if (variant === "audio") filter.streamKind = "audio";
      if (hostClerkId) filter.hostUserId = String(hostClerkId);

      const sessions = await Livestream.find(filter)
        .sort({ startedAt: -1 })
        .limit(50)
        .lean();

      let endedSessions = [];
      if (includeEnded === "true" || includeEnded === "1") {
        const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const endedFilter = {
          status: "ended",
          endedAt: { $gte: since },
        };
        if (variant === "market") endedFilter.streamKind = "market";
        else if (variant === "community") endedFilter.streamKind = "community";
        else if (variant === "audio") endedFilter.streamKind = "audio";

        endedSessions = await Livestream.find(endedFilter)
          .sort({ endedAt: -1 })
          .limit(20)
          .lean();
      }

      const allRows = [...sessions, ...endedSessions];
      const hostNames = await hostNamesByClerkIds(allRows.map((s) => s.hostUserId));

      const mapSession = (s, status) => ({
        callId: s.callId,
        hostClerkId: s.hostUserId,
        hostName:
          s.hostDisplayName?.trim() ||
          hostNames.get(s.hostUserId) ||
          "Member",
        variant: s.streamKind,
        roomTitle: s.title,
        level: s.county,
        viewerCount: s.viewerCount || 0,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        status,
        custom: {},
      });

      return res.json({
        ok: true,
        sessions: [
          ...sessions.map((s) => mapSession(s, "live")),
          ...endedSessions.map((s) => mapSession(s, "ended")),
        ],
      });
    } catch (err) {
      console.error("live active error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/live/viewer/join", async (req, res) => {
    try {
      const { callId, userId } = req.body;
      if (!callId) {
        return res.status(400).json({ ok: false, error: "callId required" });
      }

      const updated = await Livestream.findOneAndUpdate(
        { callId, status: "live" },
        { $inc: { viewerCount: 1 } },
        { new: true },
      );

      const count = updated?.viewerCount ?? 0;
      emitToLive(io, callId, "live:viewer_count", { callId, viewerCount: count });

      if (userId) {
        const joinPayload = {
          callId,
          userId,
          userName: (req.body.userName || "").trim() || "Member",
          sentAt: Date.now(),
        };
        emitToLive(io, callId, "live:join_ping", joinPayload);
        await persistLiveEvent(callId, "live:join_ping", joinPayload);
      }

      return res.json({ ok: true, viewerCount: count });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/live/viewer/leave", async (req, res) => {
    try {
      const { callId, userId, userName } = req.body;
      if (!callId) {
        return res.status(400).json({ ok: false, error: "callId required" });
      }

      const updated = await Livestream.findOneAndUpdate(
        { callId, status: "live", viewerCount: { $gt: 0 } },
        { $inc: { viewerCount: -1 } },
        { new: true },
      );

      const count = Math.max(0, updated?.viewerCount ?? 0);
      emitToLive(io, callId, "live:viewer_count", { callId, viewerCount: count });

      if (userId) {
        const leavePayload = {
          callId,
          userId,
          userName: (userName || "").trim() || "Member",
        };
        emitToLive(io, callId, "live:leave_ping", leavePayload);
        await persistLiveEvent(callId, "live:leave_ping", leavePayload);
      }

      return res.json({ ok: true, viewerCount: count });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/live/guest/invite", async (req, res) => {
    try {
      const { callId, hostClerkId, guestUserId, guestName } = req.body;
      if (!callId || !hostClerkId || !guestUserId) {
        return res.status(400).json({ ok: false, error: "Missing guest invite fields" });
      }

      const tokenResult = buildRtcToken({
        channelName: callId,
        uid: clerkIdToUid(guestUserId),
        role: "publisher",
        context: "liveGuest",
      });

      emitToUser(io, guestUserId, "live:guest_invite", {
        callId,
        hostClerkId,
        guestUserId,
        guestName,
        token: tokenResult.token,
        uid: tokenResult.uid,
        appId: tokenResult.appId,
      });

      await persistLiveEvent(callId, "live:guest_invite", {
        callId,
        hostClerkId,
        guestUserId,
        guestName,
        token: tokenResult.token,
        uid: tokenResult.uid,
        appId: tokenResult.appId,
      });

      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/live/guest/deny", async (req, res) => {
    try {
      const { callId, guestUserId, hostClerkId } = req.body;
      if (!callId || !guestUserId) {
        return res.status(400).json({ ok: false, error: "callId and guestUserId required" });
      }

      emitToUser(io, guestUserId, "live:speak_denied", {
        callId,
        targetUserId: guestUserId,
        hostClerkId,
      });
      emitToLive(io, callId, "live:speak_denied", {
        callId,
        targetUserId: guestUserId,
      });

      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/live/event", async (req, res) => {
    try {
      const { callId, type, payload = {} } = req.body;
      if (!callId || !type) {
        return res.status(400).json({ ok: false, error: "callId and type required" });
      }

      const allowed = [
        "live:chat",
        "live:reaction",
        "live:join_ping",
        "live:leave_ping",
        "live:speak_request",
        "live:gift",
        "live:donation",
        "live:speak_denied",
        "live:guest_on_stage",
        "live:guest_off_stage",
        "live:guest_muted",
        "live:guest_unmuted",
      ];
      const eventName = allowed.includes(type) ? type : null;
      if (!eventName) {
        return res.status(400).json({ ok: false, error: "Invalid event type" });
      }

      emitToLive(io, callId, eventName, { callId, ...payload });
      await persistLiveEvent(callId, eventName, { callId, ...payload });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  /** Poll live events (Vercel / serverless — no Socket.IO). */
  router.get("/live/:callId/events", async (req, res) => {
    try {
      const { callId } = req.params;
      if (!callId) {
        return res.status(400).json({ ok: false, error: "callId required" });
      }

      const sinceRaw = req.query.since;
      const sinceMs = Number(sinceRaw);
      const sinceDate = Number.isFinite(sinceMs) && sinceMs > 0
        ? new Date(sinceMs)
        : new Date(Date.now() - 30_000);
      const viewerUserId =
        typeof req.query.userId === "string" ? req.query.userId.trim() : "";

      const rows = await LiveEvent.find({
        callId,
        createdAt: { $gt: sinceDate },
      })
        .sort({ createdAt: 1 })
        .limit(120)
        .lean();

      const events = rows
        .filter((row) => {
          if (row.eventType !== "live:guest_invite") return true;
          if (!viewerUserId) return false;
          return row.payload?.guestUserId === viewerUserId;
        })
        .map((row) => ({
          type: row.eventType,
          ...(row.payload || {}),
          eventId: row.eventId,
          createdAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
        }));

      const cursor =
        events.length > 0
          ? events[events.length - 1].createdAt
          : sinceDate.getTime();

      return res.json({
        ok: true,
        events,
        cursor,
        serverTime: Date.now(),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
};
