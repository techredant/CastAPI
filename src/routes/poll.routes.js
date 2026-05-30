const express = require("express");
const mongoose = require("mongoose");
const Poll = require("../models/poll");
const PollVote = require("../models/pollVote");
const PollComment = require("../models/pollComment");
const User = require("../models/user");
const {
  userDisplayName,
  userSnapshot,
  serializePoll,
  buildLevelQuery,
  refreshTrendingScores,
  closeExpiredPolls,
  notifyPollEndingSoon,
  getPollAnalytics,
} = require("../services/poll.service");
const {
  getPollBroadcastRooms,
  livePollRoom,
} = require("../utils/pollRooms");

module.exports = (io) => {
  const router = express.Router();
  const notify =
    require("../services/notificationEngine.service").notify;

  async function listPolls(req, res) {
    try {
      const {
        levelType,
        levelValue,
        tab = "active",
        page = 1,
        limit = 20,
        userId,
        liveCallId,
      } = req.query;

      await closeExpiredPolls(notify, io);
      await notifyPollEndingSoon(notify, io);

      const query = liveCallId
        ? { liveCallId: String(liveCallId) }
        : { ...buildLevelQuery(levelType, levelValue) };

      const now = new Date();
      if (tab === "closed") {
        query.status = "closed";
      } else {
        query.status = "active";
        query.expiresAt = { $gt: now };
      }

      let sort = { createdAt: -1 };
      if (tab === "trending") {
        await refreshTrendingScores();
        sort = { trendingScore: -1, totalVotes: -1, createdAt: -1 };
      }

      const polls = await Poll.find(query)
        .sort(sort)
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit));

      let myVotes = {};
      if (userId && polls.length) {
        const votes = await PollVote.find({
          userId: String(userId),
          pollId: { $in: polls.map((p) => p._id) },
        });
        myVotes = Object.fromEntries(
          votes.map((v) => [String(v.pollId), String(v.optionId)]),
        );
      }

      const serialized = polls.map((p) =>
        serializePoll(p, {
          myVoteOptionId: myVotes[String(p._id)] || null,
          hasVoted: Boolean(myVotes[String(p._id)]),
        }),
      );

      return res.json(serialized);
    } catch (err) {
      console.error("GET /polls:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }

  const broadcastPoll = (poll, eventName, payload) => {
    const rooms = getPollBroadcastRooms(poll.levelType, poll.levelValue);
    for (const room of rooms) {
      io.to(room).emit(eventName, payload);
    }
    const liveRoom = livePollRoom(poll.liveCallId);
    if (liveRoom) {
      io.to(liveRoom).emit(eventName, payload);
    }
  };

  const emitVoteUpdate = async (poll) => {
    const payload = serializePoll(poll, {
      myVoteOptionId: undefined,
    });
    broadcastPoll(poll, "pollVoteUpdated", payload);
  };

  /** POST /api/polls — create poll */
  router.post("/", async (req, res) => {
    try {
      const {
        userId,
        question,
        options,
        levelType,
        levelValue,
        expiresAt,
        isAnonymous,
        verifiedOnly,
        liveCallId,
      } = req.body;

      if (!userId || !question?.trim() || !Array.isArray(options)) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const trimmedOptions = options
        .map((o) => String(o).trim())
        .filter(Boolean)
        .slice(0, 4);
      if (trimmedOptions.length < 2) {
        return res.status(400).json({ message: "At least 2 options required" });
      }

      const user = await User.findOne({ clerkId: userId });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const expiry = expiresAt ? new Date(expiresAt) : null;
      if (!expiry || Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
        return res.status(400).json({ message: "Invalid expiration date" });
      }

      const resolvedLevelType = levelType || "county";
      const resolvedLevelValue =
        levelValue ||
        user.county ||
        user.constituency ||
        user.ward ||
        "Kenya";

      const poll = await Poll.create({
        creatorId: userId,
        question: question.trim(),
        options: trimmedOptions.map((text) => ({ text, voteCount: 0 })),
        levelType: resolvedLevelType,
        levelValue: resolvedLevelValue,
        expiresAt: expiry,
        isAnonymous: !!isAnonymous,
        verifiedOnly: !!verifiedOnly,
        liveCallId: liveCallId || null,
        creator: userSnapshot(user),
      });

      const payload = serializePoll(poll);
      broadcastPoll(poll, "newPoll", payload);

      void (async () => {
        try {
          const levelQuery = buildLevelQuery(
            poll.levelType,
            poll.levelValue,
          );
          const sampleUsers = await User.find({
            clerkId: { $ne: userId },
          })
            .select("clerkId county constituency ward")
            .limit(800);

          const recipients = sampleUsers.filter((u) => {
            if (poll.levelType === "national") return true;
            if (poll.levelType === "county") {
              return u.county === poll.levelValue;
            }
            if (poll.levelType === "constituency") {
              return u.constituency === poll.levelValue;
            }
            if (poll.levelType === "ward") {
              return u.ward === poll.levelValue;
            }
            return true;
          });

          for (const viewer of recipients.slice(0, 200)) {
            await notify({
              userId: viewer.clerkId,
              type: liveCallId ? "live_poll" : "poll_created",
              title: liveCallId ? "Live poll" : "New poll",
              body: `${userDisplayName(user)}: ${poll.question.slice(0, 80)}`,
              actor: {
                userId: user.clerkId,
                name: userDisplayName(user),
                image: user.image,
              },
              entityId: String(poll._id),
              entityType: "poll",
              data: {
                screen: "poll",
                pollId: String(poll._id),
                liveCallId: liveCallId || undefined,
                category: "social",
              },
              io,
              dedupeWindowMs: 120_000,
            });
          }
        } catch (err) {
          console.error("poll create notify:", err);
        }
      })();

      return res.status(201).json(payload);
    } catch (err) {
      console.error("POST /polls:", err);
      return res.status(500).json({ message: err.message || "Server error" });
    }
  });

  /** GET /api/polls — feed (tab=active|trending|closed) */
  router.get("/", listPolls);

  /** GET /api/polls/trending */
  router.get("/trending", (req, res) => {
    req.query.tab = "trending";
    return listPolls(req, res);
  });

  /** GET /api/polls/:id/analytics */
  router.get("/:id/analytics", async (req, res) => {
    try {
      const analytics = await getPollAnalytics(req.params.id);
      return res.json(analytics);
    } catch (err) {
      return res.status(500).json({ message: "Server error" });
    }
  });

  /** GET /api/polls/:id */
  router.get("/:id", async (req, res) => {
    try {
      const poll = await Poll.findById(req.params.id);
      if (!poll) {
        return res.status(404).json({ message: "Poll not found" });
      }

      if (poll.status === "active" && poll.expiresAt <= new Date()) {
        poll.status = "closed";
        poll.closedAt = new Date();
        await poll.save();
      }

      let myVoteOptionId = null;
      const { userId } = req.query;
      if (userId) {
        const vote = await PollVote.findOne({
          pollId: poll._id,
          userId: String(userId),
        });
        myVoteOptionId = vote ? String(vote.optionId) : null;
      }

      const analytics =
        req.query.analytics === "true"
          ? await getPollAnalytics(String(poll._id))
          : undefined;

      return res.json(
        serializePoll(poll, {
          myVoteOptionId,
          hasVoted: Boolean(myVoteOptionId),
          analytics,
        }),
      );
    } catch (err) {
      console.error("GET /polls/:id:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/polls/:id/vote */
  router.post("/:id/vote", async (req, res) => {
    try {
      const { userId, optionId } = req.body;
      if (!userId || !optionId) {
        return res.status(400).json({ message: "userId and optionId required" });
      }

      const poll = await Poll.findById(req.params.id);
      if (!poll) {
        return res.status(404).json({ message: "Poll not found" });
      }

      if (poll.status !== "active" || poll.expiresAt <= new Date()) {
        return res.status(400).json({ message: "Poll is closed" });
      }

      const user = await User.findOne({ clerkId: userId });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (poll.verifiedOnly && !user.isVerified) {
        return res
          .status(403)
          .json({ message: "Only verified accounts can vote on this poll" });
      }

      const option = poll.options.id(optionId);
      if (!option) {
        return res.status(400).json({ message: "Invalid option" });
      }

      const existing = await PollVote.findOne({
        pollId: poll._id,
        userId,
      });
      if (existing) {
        return res.status(409).json({
          message: "You already voted",
          myVoteOptionId: String(existing.optionId),
        });
      }

      await PollVote.create({
        pollId: poll._id,
        userId,
        optionId: new mongoose.Types.ObjectId(optionId),
        levelType: user.county ? "county" : poll.levelType,
        levelValue: user.county || poll.levelValue,
      });

      option.voteCount += 1;
      poll.totalVotes += 1;
      poll.trendingScore = (poll.votesLast24h || 0) * 3 + poll.totalVotes;
      await poll.save();

      await emitVoteUpdate(poll);

      return res.json(
        serializePoll(poll, {
          myVoteOptionId: String(optionId),
          hasVoted: true,
        }),
      );
    } catch (err) {
      if (err?.code === 11000) {
        return res.status(409).json({ message: "You already voted" });
      }
      console.error("POST vote:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });

  /** GET /api/polls/:id/comments */
  router.get("/:id/comments", async (req, res) => {
    try {
      const { page = 1, limit = 30 } = req.query;
      const comments = await PollComment.find({ pollId: req.params.id })
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit));
      return res.json(comments);
    } catch (err) {
      return res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/polls/:id/comments */
  router.post("/:id/comments", async (req, res) => {
    try {
      const { userId, text } = req.body;
      if (!userId || !text?.trim()) {
        return res.status(400).json({ message: "userId and text required" });
      }

      const poll = await Poll.findById(req.params.id);
      if (!poll) {
        return res.status(404).json({ message: "Poll not found" });
      }

      const user = await User.findOne({ clerkId: userId });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const comment = await PollComment.create({
        pollId: poll._id,
        userId,
        text: text.trim(),
        user: userSnapshot(user),
      });

      poll.commentCount += 1;
      await poll.save();

      if (poll.creatorId !== userId) {
        await notify({
          userId: poll.creatorId,
          type: "comment",
          title: "Poll comment",
          body: `${userDisplayName(user)} commented on your poll`,
          actor: {
            userId: user.clerkId,
            name: userDisplayName(user),
            image: user.image,
          },
          entityId: String(poll._id),
          entityType: "poll",
          data: {
            screen: "poll",
            pollId: String(poll._id),
            category: "social",
          },
          io,
        });
      }

      broadcastPoll(poll, "pollCommentAdded", {
        pollId: String(poll._id),
        comment,
      });

      return res.status(201).json(comment);
    } catch (err) {
      console.error("POST poll comment:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/polls/:id/comments/:commentId/like */
  router.post("/:id/comments/:commentId/like", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "userId required" });
      }

      const comment = await PollComment.findOne({
        _id: req.params.commentId,
        pollId: req.params.id,
      });
      if (!comment) {
        return res.status(404).json({ message: "Comment not found" });
      }

      const likes = Array.isArray(comment.likes) ? comment.likes : [];
      const hasLiked = likes.includes(userId);
      comment.likes = hasLiked
        ? likes.filter((id) => id !== userId)
        : [...likes, userId];
      await comment.save();

      return res.json(comment);
    } catch (err) {
      console.error("POST poll comment like:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/polls/:id/share */
  router.post("/:id/share", async (req, res) => {
    try {
      const poll = await Poll.findByIdAndUpdate(
        req.params.id,
        { $inc: { shareCount: 1 } },
        { new: true },
      );
      if (!poll) {
        return res.status(404).json({ message: "Poll not found" });
      }
      return res.json({
        shareCount: poll.shareCount,
        url: `/(drawer)/polls/${poll._id}`,
      });
    } catch (err) {
      return res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
