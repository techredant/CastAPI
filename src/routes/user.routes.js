// routes/user.routes.js
require("dotenv").config();
const express = require("express");
const User = require("../models/user");
const Post = require("../models/post");
const { expireVerificationIfNeeded } = require("../../services/verification.service");
const { notify } = require("../services/notificationEngine.service");

const { StreamChat } = require("stream-chat");

module.exports = (io) => {
  const express = require("express");

const router = express.Router();

const chatServer = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

const PROFILE_UPDATE_COOLDOWN_MS = 60 * 1000;
// const PROFILE_UPDATE_COOLDOWN_MS = 48 * 60 * 60 * 1000; // production: 48 hours

const applyPendingProfileUpdates = async (user) => {
  if (!user?.profileUpdateAt) return user;

  if (new Date() >= new Date(user.profileUpdateAt)) {
    if (user.pendingFirstName) user.firstName = user.pendingFirstName;
    if (user.pendingLastName) user.lastName = user.pendingLastName;
    if (user.pendingNickName) user.nickName = user.pendingNickName;
    if (user.pendingImage) user.image = user.pendingImage;
    if (user.pendingCompanyName) user.companyName = user.pendingCompanyName;

    // clear pending
    user.pendingFirstName = undefined;
    user.pendingLastName = undefined;
    user.pendingNickName = undefined;
    user.pendingImage = undefined;
    user.pendingCompanyName = undefined;

    user.profileUpdateAt = null;

    await user.save();
  }

  return user;
};

// const STREAM_VIDEO_API = "https://video.stream-io-api.com/video/v1";
// const STREAM_VIDEO_KEY = process.env.STREAM_VIDEO_KEY;
// const STREAM_VIDEO_SECRET = process.env.STREAM_VIDEO_SECRET;

// ------------------- CREATE OR UPDATE USER -------------------
router.post("/create-user", async (req, res) => {
  try {
    const {
      clerkId,
      email,
      firstName,
      lastName,
      image,
      nickName,
      companyName,
      provider,
      accountType,
    } = req.body;

    if (!clerkId || !email) {
      return res.status(400).json({ message: "Missing clerkId or email" });
    }

    let user = await User.findOne({ clerkId });
    user = await applyPendingProfileUpdates(user);
    // ---------------- USER EXISTS ----------------
    if (user) {
      if (
        user.profileUpdateAt &&
        new Date(user.profileUpdateAt).getTime() > Date.now()
      ) {
        return res.status(429).json({
          success: false,
          message:
            "A profile update is already scheduled. Please wait for it to go live.",
          profileUpdateAt: user.profileUpdateAt,
          user,
        });
      }

      // SAVE PENDING UPDATES (NOT LIVE YET)
      if (firstName !== undefined) user.pendingFirstName = firstName;
      if (lastName !== undefined) user.pendingLastName = lastName;
      if (nickName) user.pendingNickName = nickName;
      if (image) user.pendingImage = image;
      if (companyName !== undefined) user.pendingCompanyName = companyName;
      if (provider) user.provider = provider;
      if (accountType) user.accountType = accountType;

      user.profileUpdateAt = new Date(Date.now() + PROFILE_UPDATE_COOLDOWN_MS);

      await user.save();

      return res.status(200).json({
        success: true,
        message: `Your profile update will appear after ${PROFILE_UPDATE_COOLDOWN_MS / 1000} seconds`,
        profileUpdateAt: user.profileUpdateAt,
        user,
      });
    }

    // ---------------- NEW USER ----------------
    user = await User.create({
      clerkId,
      email,
      firstName: firstName || "",
      lastName: lastName || "",
      nickName: nickName || "",
      companyName: companyName || "",
      image: image || "",
      provider: provider || "clerk",
      accountType: accountType || "Personal Account",
    });

    return res.status(201).json({
      success: true,
      user,
      message: "User created",
    });
  } catch (err) {
    console.error("Error creating/updating user:", err);
    res.status(500).json({ message: "Server error" });
  }
});

//stream io
router.post("/create-or-get-user", async (req, res) => {
  try {
    const { clerkId, email, firstName, lastName, nickName, image } = req.body;

    if (!clerkId) {
      return res.status(400).json({ message: "Missing clerkId" });
    }

    // --- Find or create local user ---
    let user = await User.findOne({ clerkId });

    if (!user) {
      user = await User.create({
        clerkId,
        email: email || "",
        firstName: firstName || "",
        lastName: lastName || "",
        nickName: nickName || "",
        image: image || "",
      });
    }

    // --- Prepare display name ---
    const displayName = user.nickName || user.firstName || user.email || "User";

    // --- Upsert user in Stream ---
    await chatServer.upsertUser({
      id: user.clerkId,
      name: displayName,
      image: user.image || undefined,
    });

    // --- Generate tokens ---
    const chatToken = chatServer.createToken(user.clerkId);
    const { getPublicAppId } = require("../services/agoraToken.service");
    const agoraAppId = getPublicAppId();

    res.json({ user, chatToken, agoraAppId });
  } catch (err) {
    console.error("Error in create-or-get-user:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- UPDATE USER LOCATION -------------------
router.post("/update-location", async (req, res) => {
  try {
    const { clerkId, county, constituency, ward } = req.body;

    if (!clerkId) {
      return res.status(400).json({ error: "clerkId required" });
    }

    const user = await User.findOneAndUpdate(
      { clerkId },
      { county, constituency, ward },
      { new: true },
    );

    res.json(user);
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({ error: "Server error updating location" });
  }
});

// ------------------- GET USER BY CLERKID -------------------
router.get("/:clerkId", async (req, res) => {
  try {
    const { clerkId } = req.params;
    let user = await User.findOne({ clerkId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user = await applyPendingProfileUpdates(user);
    await expireVerificationIfNeeded(user);

    res.json(user);
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- LEGACY ADMIN VERIFY (prefer /api/verification/admin) -------------------
router.patch("/:id/verify", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (req.body.isVerified) {
      user.isVerified = true;
      user.verificationType = req.body.verificationType || "personal";
      user.verifiedAt = new Date();
      const expires = new Date();
      expires.setDate(expires.getDate() + 365);
      user.verificationExpiresAt = expires;
    } else {
      user.isVerified = false;
      user.verificationType = undefined;
      user.verifiedAt = null;
      user.verificationExpiresAt = null;
    }
    await user.save();

    const { syncUserVerifiedOnPosts } = require("../../services/verification.service");
    await syncUserVerifiedOnPosts(
      user.clerkId,
      user.isVerified,
      user.verificationType,
    );

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- UPDATE USER IMAGE -------------------
router.post("/update-image", async (req, res) => {
  try {
    const { clerkId, image } = req.body;
    if (!clerkId || !image) {
      return res.status(400).json({ error: "clerkId and image are required" });
    }

    const user = await User.findOneAndUpdate(
      { clerkId },
      { image },
      { new: true },
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error("Error updating profile image:", err);
    res.status(500).json({ error: "Server error" });
  }
});
// POST /:clerkId/follow-action/:targetClerkId?action=follow|unfollow
router.post("/:clerkId/follow-action/:targetClerkId", async (req, res) => {
  try {
    const { clerkId, targetClerkId } = req.params;
    const action = req.query.action;

    if (!["follow", "unfollow"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    if (clerkId === targetClerkId) {
      return res.status(400).json({ error: "You cannot follow yourself" });
    }

    const user = await User.findOne({ clerkId });
    const target = await User.findOne({ clerkId: targetClerkId });

    if (!user || !target) {
      return res.status(404).json({ error: "User not found" });
    }

    // ensure arrays exist
    user.following = user.following || [];
    target.followers = target.followers || [];

    let isNowFollowing = false;

    // ---------------- FOLLOW ----------------
    if (action === "follow") {
      if (!target.followers.includes(clerkId)) {
        target.followers.push(clerkId);
      }

      if (!user.following.includes(targetClerkId)) {
        user.following.push(targetClerkId);
      }

      isNowFollowing = true;
    }

    // ---------------- UNFOLLOW ----------------
    if (action === "unfollow") {
      target.followers = target.followers.filter((id) => id !== clerkId);

      user.following = user.following.filter((id) => id !== targetClerkId);

      isNowFollowing = false;
    }

    await target.save();
    await user.save();

    // 🔥 ONLY SEND NOTIFICATION ON FOLLOW (NOT UNFOLLOW)
if (isNowFollowing) {
  const actorName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.nickName ||
    user.companyName ||
    "Someone";

  await notify({
    userId: targetClerkId,
    type: "follow",
    actor: {
      userId: clerkId,
      name: actorName,
      image: user.image,
    },
    entityId: null,
    data: {
      screen: "follow",
      authorId: clerkId,
      category: "social",
    },
    io,
    title: "New follower",
    body: `${actorName} started following you`,
  });
}

    return res.json({
      success: true,
      message: isNowFollowing ? "Followed" : "Unfollowed",
      target,
    });
  } catch (error) {
    console.error("Follow error FULL:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:clerkId/follow-state", async (req, res) => {
  try {
    const { clerkId } = req.params;

    const user = await User.findOne({ clerkId });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    console.log("FOLLOWING FROM DB:", user.following); // 🔥 debug

    res.json({
      following: user.following || [],
      followers: user.followers || [],
    });
  } catch (err) {
    console.error("FULL CREATE USER ERROR:", err);

    if (err.code === 11000) {
      return res.status(409).json({
        message: "Nickname already exists",
        field: Object.keys(err.keyPattern)[0],
      });
    }

    res.status(500).json({
      message: err.message,
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const { clerkId, cursor } = req.query;



    // ---------------------------
    // FILTER (NO EXCLUSION OF SELF)
    // ---------------------------
    const filter = {};

    // ---------------------------
    // PAGINATION
    // ---------------------------
    if (cursor) {
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    // ---------------------------
    // FETCH USERS
    // ---------------------------
    const users = await User.find(filter)
      .sort({ _id: -1 })
      .select(
        "clerkId firstName lastName nickName companyName image county constituency ward followers following",
      );

    // ---------------------------
    // CURRENT USER
    // ---------------------------
    const currentUser = clerkId
      ? await User.findOne({ clerkId }).select("following")
      : null;

    // ---------------------------
    // FORMAT RESPONSE
    // ---------------------------
    const formatted = users.map((u) => ({
      id: u._id,
      clerkId: u.clerkId,
      firstName: u.firstName,
      lastName: u.lastName,
      nickName: u.nickName,
      companyName: u.companyName,
      image: u.image,
      county: u.county,
      constituency: u.constituency,
      ward: u.ward,
    }));

    // ---------------------------
    // NEXT CURSOR
    // ---------------------------
    const nextCursor =
      users.length ===  users[users.length - 1]._id;

    res.json({
      users: formatted,
      nextCursor,
    });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Server error fetching users" });
  }
});


// ------------------- SEARCH USER -------------------
router.get("/search", async (req, res) => {
  try {
    const { query, clerkId, cursor } = req.query;

    if (!query || query.trim() === "") {
      return res.json({
        users: [],
        nextCursor: null,
      });
    }


    const filter = {
      ...(clerkId && { clerkId: { $ne: clerkId } }),
      $or: [
        { firstName: { $regex: query, $options: "i" } },
        { lastName: { $regex: query, $options: "i" } },
        { nickName: { $regex: query, $options: "i" } },
        { companyName: { $regex: query, $options: "i" } },
      ],
    };

    if (cursor) {
      filter._id = { $lt: cursor };
    }

    const users = await User.find(filter).sort({ _id: -1 });

    let currentUser = null;

    if (clerkId) {
      currentUser = await User.findOne({ clerkId }).select("following");
    }

   const formatted = users.map((u) => ({
     id: u._id,
     clerkId: u.clerkId,
     name:
       `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() ||
       u.nickName || u.companyName ||
       "Unknown User",
     image: u.image,
   }));

    const nextCursor =
      users.length === users[users.length - 1]._id;

    res.json({
      users: formatted,
      nextCursor,
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------- LOOKUP BY NICKNAME (mentions) -------------------
router.get("/by-nick/:nick", async (req, res) => {
  try {
    const nick = String(req.params.nick || "")
      .replace(/^@+/, "")
      .trim();
    if (!nick) {
      return res.status(400).json({ message: "Nickname required" });
    }

    const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const user = await User.findOne({
      nickName: { $regex: new RegExp(`^@?${escaped}$`, "i") },
    }).select(
      "clerkId nickName firstName lastName image isVerified companyName",
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      clerkId: user.clerkId,
      nickName: user.nickName,
      firstName: user.firstName,
      lastName: user.lastName,
      image: user.image,
      isVerified: user.isVerified,
      companyName: user.companyName,
    });
  } catch (err) {
    console.error("by-nick error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

return router;
}
