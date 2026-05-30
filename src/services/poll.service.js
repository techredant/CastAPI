const mongoose = require("mongoose");
const Poll = require("../models/poll");
const PollVote = require("../models/pollVote");
const User = require("../models/user");
const kenyaData = require("../assets/iebc.json");
const {
  getPollBroadcastRooms,
  livePollRoom,
} = require("../utils/pollRooms");

function userDisplayName(user) {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.nickName || user.companyName || "User";
}

function userSnapshot(user) {
  return {
    clerkId: user.clerkId,
    firstName: user.firstName,
    lastName: user.lastName,
    nickName: user.nickName,
    companyName: user.companyName,
    image: user.image,
    isVerified: !!user.isVerified,
    verificationType: user.verificationType || "",
  };
}

function serializePoll(poll, extras = {}) {
  const raw =
    poll && typeof poll.toObject === "function"
      ? poll.toObject({ virtuals: true })
      : { ...poll };
  if (raw._id != null) raw._id = String(raw._id);
  const options = (raw.options || []).map((o) => ({
    ...o,
    _id: String(o._id),
    voteCount: o.voteCount || 0,
  }));
  const totalVotes = raw.totalVotes || 0;
  const optionsWithPct = options.map((o) => ({
    ...o,
    percent: totalVotes > 0 ? Math.round((o.voteCount / totalVotes) * 1000) / 10 : 0,
  }));
  return {
    ...raw,
    options: optionsWithPct,
    totalVotes,
    ...extras,
  };
}

function getRelatedLevels(levelType, levelValue) {
  switch (levelType) {
    case "national":
      return { levelTypes: ["national"], levelValues: ["Kenya", "all", levelValue] };

    case "home":
      return {
        levelTypes: ["national", "home", "county"],
        levelValues: null,
      };

    case "county": {
      const county = kenyaData.counties?.find((c) => c.name === levelValue);
      const constituencyNames =
        county?.constituencies?.map((c) => c.name) || [];
      return {
        levelTypes: ["national", "home", "county", "constituency"],
        levelValues: [levelValue, "Kenya", "home", "all", ...constituencyNames],
      };
    }

    case "constituency": {
      const values = [levelValue];
      for (const county of kenyaData.counties || []) {
        const constituency = county.constituencies?.find(
          (c) => c.name === levelValue,
        );
        if (constituency) {
          values.push(county.name);
          for (const ward of constituency.wards || []) {
            values.push(ward.name);
          }
          break;
        }
      }
      return {
        levelTypes: ["national", "home", "county", "constituency", "ward"],
        levelValues: [...new Set([...values, "Kenya", "home", "all"])],
      };
    }

    case "ward": {
      const values = [levelValue];
      for (const county of kenyaData.counties || []) {
        for (const constituency of county.constituencies || []) {
          const ward = constituency.wards?.find((w) => w.name === levelValue);
          if (ward) {
            values.push(constituency.name, county.name);
            break;
          }
        }
      }
      return {
        levelTypes: ["national", "home", "county", "constituency", "ward"],
        levelValues: [...new Set([...values, "Kenya", "home", "all"])],
      };
    }

    default:
      return { levelTypes: [levelType], levelValues: [levelValue] };
  }
}

function buildLevelQuery(levelType, levelValue) {
  const { levelTypes, levelValues } = getRelatedLevels(levelType, levelValue);
  const query = { levelType: { $in: levelTypes } };
  if (levelValues) {
    query.levelValue = { $in: levelValues };
  }
  return query;
}

async function refreshTrendingScores() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const active = await Poll.find({ status: "active", expiresAt: { $gt: new Date() } });

  for (const poll of active) {
    const recent = await PollVote.countDocuments({
      pollId: poll._id,
      createdAt: { $gte: since },
    });
    poll.votesLast24h = recent;
    poll.trendingScore = recent * 3 + (poll.totalVotes || 0);
    await poll.save();
  }
}

async function closeExpiredPolls(notifyFn, io) {
  const now = new Date();
  const expired = await Poll.find({
    status: "active",
    expiresAt: { $lte: now },
  });

  for (const poll of expired) {
    poll.status = "closed";
    poll.closedAt = now;
    await poll.save();

    if (io) {
      const payload = serializePoll(poll);
      for (const room of getPollBroadcastRooms(poll.levelType, poll.levelValue)) {
        io.to(room).emit("pollClosed", payload);
      }
      const liveRoom = livePollRoom(poll.liveCallId);
      if (liveRoom) {
        io.to(liveRoom).emit("pollClosed", payload);
      }
    }

    if (notifyFn) {
      const viewers = await User.find({
        $or: [
          { county: poll.levelValue },
          { constituency: poll.levelValue },
          { ward: poll.levelValue },
        ],
      })
        .select("clerkId")
        .limit(500);

      const recipientIds = new Set(viewers.map((u) => u.clerkId));
      recipientIds.add(poll.creatorId);

      for (const uid of recipientIds) {
        if (!uid) continue;
        await notifyFn({
          userId: uid,
          type: "poll_ended",
          title: "Poll ended",
          body: poll.question.slice(0, 80),
          entityId: String(poll._id),
          entityType: "poll",
          data: {
            screen: "poll",
            pollId: String(poll._id),
            category: "social",
          },
          io,
          skipPersist: uid !== poll.creatorId,
        });
      }
    }
  }

  return expired.length;
}

async function notifyPollEndingSoon(notifyFn, io) {
  if (!notifyFn) return 0;
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  const now = new Date();
  const polls = await Poll.find({
    status: "active",
    endingNotified: { $ne: true },
    expiresAt: { $gt: now, $lte: soon },
  });

  for (const poll of polls) {
    poll.endingNotified = true;
    await poll.save();
    await notifyFn({
      userId: poll.creatorId,
      type: "poll_ending",
      title: "Poll ending soon",
      body: `"${poll.question.slice(0, 60)}" ends in under 1 hour`,
      entityId: String(poll._id),
      entityType: "poll",
      data: { screen: "poll", pollId: String(poll._id), category: "social" },
      io,
    });
  }
  return polls.length;
}

/** Aggregation analytics for dashboard / poll detail */
async function getPollAnalytics(pollId) {
  const byOption = await PollVote.aggregate([
    { $match: { pollId: new mongoose.Types.ObjectId(pollId) } },
    {
      $group: {
        _id: "$optionId",
        votes: { $sum: 1 },
      },
    },
    { $sort: { votes: -1 } },
  ]);

  const byHour = await PollVote.aggregate([
    { $match: { pollId: new mongoose.Types.ObjectId(pollId) } },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d %H:00", date: "$createdAt" },
        },
        votes: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 48 },
  ]);

  const byLevel = await PollVote.aggregate([
    { $match: { pollId: new mongoose.Types.ObjectId(pollId) } },
    {
      $group: {
        _id: { levelType: "$levelType", levelValue: "$levelValue" },
        votes: { $sum: 1 },
      },
    },
    { $sort: { votes: -1 } },
    { $limit: 20 },
  ]);

  return { byOption, byHour, byLevel };
}

module.exports = {
  userDisplayName,
  userSnapshot,
  serializePoll,
  getRelatedLevels,
  buildLevelQuery,
  refreshTrendingScores,
  closeExpiredPolls,
  notifyPollEndingSoon,
  getPollAnalytics,
};
