// /api/dashboard/overview

const express = require("express");
const User = require("../models/User");

const router = express.Router();

router.get("/overview", async (req, res) => {
  try {
    // 🔹 BASIC STATS
    const totalUsers = await User.countDocuments();
    const verifiedUsers = await User.countDocuments({ isVerified: true });
    const unverifiedUsers = await User.countDocuments({ isVerified: false });

    const politicians = await User.countDocuments({
      accountType: "politician",
    });

    // 🔹 USER SEGMENTS (pie chart)
    const segments = [
      { name: "Verified", value: verifiedUsers },
      { name: "Unverified", value: unverifiedUsers },
    ];

    // 🔹 USERS BY LEVEL (derived)
    const users = await User.find();

    const levelCounts = {
      National: 0,
      County: 0,
      Constituency: 0,
      Ward: 0,
    };

    users.forEach((u) => {
      if (u.ward) levelCounts.Ward++;
      else if (u.constituency) levelCounts.Constituency++;
      else if (u.county) levelCounts.County++;
      else levelCounts.National++;
    });

    const levels = Object.keys(levelCounts).map((key) => ({
      level: key,
      users: levelCounts[key],
    }));

    // 🔹 USER GROWTH (monthly using createdAt)
    const growth = await User.aggregate([
      {
        $group: {
          _id: { $month: "$createdAt" },
          users: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const loginData = growth.map((g) => ({
      month: months[g._id - 1],
      logins: g.users, // using registrations as "activity"
    }));

    // 🔹 RECENT ACTIVITY
    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(5);

    const activity = recentUsers.map((u) => ({
      user: u.nickName || `${u.firstName} ${u.lastName}`,
      action: "Registered",
      level: u.ward
        ? "Ward"
        : u.constituency
          ? "Constituency"
          : u.county
            ? "County"
            : "National",
      time: "recently",
    }));

    // 🔹 RESPONSE
    res.json({
      stats: {
        users: totalUsers,
        verified: verifiedUsers,
        unverified: unverifiedUsers,
        politicians,
      },
      logins: loginData,
      levels,
      segments,
      activity,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
