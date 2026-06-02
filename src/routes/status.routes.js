const express = require("express");
const Status = require("../models/status");
const User = require("../models/user");
const Comment = require("../models/comment");

function pickProfile(user, statusDoc) {
  const s = statusDoc?.toObject?.() ?? statusDoc ?? {};
  return {
    firstName: s.firstName || user?.firstName || "",
    lastName: s.lastName || user?.lastName || "",
    companyName: s.companyName || user?.companyName || "",
    nickName: s.nickName || user?.nickName || "",
    image: s.image || user?.image || "",
  };
}

async function enrichStatuses(statuses) {
  const list = statuses.map((s) => (s.toObject ? s.toObject() : s));
  const userIds = [...new Set(list.map((s) => String(s.userId)).filter(Boolean))];
  const users = await User.find({ clerkId: { $in: userIds } });
  const byClerk = Object.fromEntries(users.map((u) => [String(u.clerkId), u]));

  return list.map((s) => ({
    ...s,
    ...pickProfile(byClerk[String(s.userId)], s),
  }));
}

function viewerHasSeen(status, viewerId) {
  if (!viewerId) return false;
  return (status.views ?? []).some((v) => String(v.userId) === String(viewerId));
}

function groupStatusesByUser(statuses, viewerId) {
  const byUser = new Map();
  for (const row of statuses) {
    const key = String(row.userId);
    if (!byUser.has(key)) {
      byUser.set(key, {
        userId: key,
        firstName: row.firstName,
        lastName: row.lastName,
        companyName: row.companyName,
        nickName: row.nickName,
        image: row.image,
        latestAt: row.createdAt,
        hasUnviewed: false,
        statuses: [],
      });
    }
    const group = byUser.get(key);
    group.statuses.push(row);
    const created = new Date(row.createdAt).getTime();
    const latest = new Date(group.latestAt).getTime();
    if (created > latest) group.latestAt = row.createdAt;
    if (viewerId && String(row.userId) !== String(viewerId) && !viewerHasSeen(row, viewerId)) {
      group.hasUnviewed = true;
    }
  }

  const users = [...byUser.values()].map((g) => ({
    ...g,
    statuses: g.statuses.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
  }));

  users.sort(
    (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
  );

  return users;
}

module.exports = (io) => {
  const router = express.Router();

  const emitStatusCreated = (status) => {
    if (!io) return;
    io.emit("status:created", status);
  };

  const emitStatusViewed = (payload) => {
    if (!io) return;
    io.emit("status:viewed", payload);
  };

  const emitStatusDeleted = (payload) => {
    if (!io) return;
    io.emit("status:deleted", payload);
  };

  router.post("/", async (req, res) => {
    try {
      const {
        userId,
        lastName,
        firstName,
        companyName,
        nickName,
        nickname,
        image,
        caption,
        media,
        backgroundColor,
      } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "userId required" });
      }

      const dbUser = await User.findOne({ clerkId: userId });
      const profile = pickProfile(dbUser, {
        firstName,
        lastName,
        companyName,
        nickName: nickName || nickname,
        image,
      });

      const status = await Status.create({
        userId,
        ...profile,
        caption,
        media,
        likes: [],
        comments: [],
        backgroundColor,
      });

      const [enriched] = await enrichStatuses([status]);
      emitStatusCreated(enriched);
      res.status(201).json(enriched);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  /** Grouped feed — one query path, sorted users, stories oldest→newest per user. */
  router.get("/feed", async (req, res) => {
    try {
      const viewerId = String(req.query.viewerId ?? "").trim();
      const userLimit = Math.min(
        Math.max(parseInt(req.query.userLimit, 10) || 0, 0),
        100,
      );
      const now = new Date();

      const match = { expiresAt: { $gt: now } };

      if (viewerId) {
        const viewer = await User.findOne({ clerkId: viewerId }).select(
          "following followers clerkId",
        );
        const following = (viewer?.following ?? []).map(String);
        const followers = (viewer?.followers ?? []).map(String);
        const allowed = new Set([viewerId, ...following, ...followers]);
        match.userId = { $in: [...allowed] };
      }

      let userIdsFilter = null;
      if (userLimit > 0) {
        const recentUsers = await Status.aggregate([
          { $match: match },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: "$userId",
              latestAt: { $first: "$createdAt" },
            },
          },
          { $sort: { latestAt: -1 } },
          { $limit: userLimit },
        ]);
        userIdsFilter = recentUsers.map((r) => r._id).filter(Boolean);
        if (!userIdsFilter.length) {
          return res.json({ users: [], flat: [] });
        }
        match.userId = match.userId
          ? { $in: userIdsFilter.filter((id) => match.userId.$in.includes(id)) }
          : { $in: userIdsFilter };
      }

      const statuses = await Status.find(match)
        .sort({ createdAt: 1 })
        .populate("comments")
        .lean();

      const enriched = await enrichStatuses(statuses);
      const users = groupStatusesByUser(enriched, viewerId);

      res.json({
        users,
        flat: enriched,
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.get("/", async (req, res) => {
    try {
      const userLimit = Math.min(
        Math.max(parseInt(req.query.userLimit, 10) || 0, 0),
        50,
      );
      const now = new Date();
      const match = { expiresAt: { $gt: now } };

      if (userLimit > 0) {
        const recentUsers = await Status.aggregate([
          { $match: match },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: "$userId",
              latestAt: { $first: "$createdAt" },
            },
          },
          { $sort: { latestAt: -1 } },
          { $limit: userLimit },
        ]);

        const userIds = recentUsers.map((r) => r._id).filter(Boolean);
        if (!userIds.length) {
          return res.json([]);
        }

        const statuses = await Status.find({
          userId: { $in: userIds },
          expiresAt: { $gt: now },
        })
          .sort({ createdAt: -1 })
          .populate("comments");

        return res.json(await enrichStatuses(statuses));
      }

      const statuses = await Status.find(match)
        .sort({ createdAt: -1 })
        .populate("comments");

      res.json(await enrichStatuses(statuses));
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.put("/:id/view", async (req, res) => {
    try {
      const { userId, firstName, companyName, nickName, lastName, image } =
        req.body;

      if (!userId) {
        return res.status(400).json({ message: "userId required" });
      }

      const status = await Status.findById(req.params.id);
      if (!status) return res.status(404).json({ message: "Not found" });

      const viewerId = String(userId);
      const authorId = String(status.userId);

      const alreadyViewed = status.views.some(
        (v) => String(v.userId) === viewerId,
      );

      if (!alreadyViewed && authorId !== viewerId) {
        status.views.push({
          userId: viewerId,
          firstName: firstName || "",
          companyName: companyName || "",
          nickName: nickName || "",
          lastName: lastName || "",
          image: image || "",
        });
        await status.save();
      }

      const [enriched] = await enrichStatuses([status]);
      emitStatusViewed({
        statusId: String(enriched._id),
        userId: viewerId,
        authorId,
        views: enriched.views,
      });
      res.json(enriched);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.get("/user/:userId", async (req, res) => {
    try {
      const now = new Date();
      const statuses = await Status.find({
        userId: req.params.userId,
        expiresAt: { $gt: now },
      }).sort({ createdAt: 1 });

      res.json(await enrichStatuses(statuses));
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.put("/:id/like", async (req, res) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "userId required" });
      }

      const status = await Status.findById(req.params.id);
      if (!status) return res.status(404).json({ message: "Not found" });

      const update = status.likes.includes(userId)
        ? { $pull: { likes: userId } }
        : { $addToSet: { likes: userId } };

      const updated = await Status.findByIdAndUpdate(req.params.id, update, {
        new: true,
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.post("/:id/comment", async (req, res) => {
    try {
      const { userId, text } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "userId required" });
      }
      const comment = await Comment.create({
        userId,
        text,
      });

      const status = await Status.findById(req.params.id);

      if (!status) {
        return res.status(404).json({ message: "Status not found" });
      }

      status.comments.push(comment._id);
      await status.save();

      res.json(comment);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "userId required" });
      }
      const status = await Status.findById(req.params.id);

      if (!status) {
        return res.status(404).json({ message: "Status not found" });
      }

      if (status.userId !== userId) {
        return res.status(403).json({ message: "Not allowed" });
      }

      const authorId = String(status.userId);
      await status.deleteOne();
      emitStatusDeleted({ statusId: req.params.id, userId: authorId });

      res.json({ message: "Status deleted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  return router;
};
