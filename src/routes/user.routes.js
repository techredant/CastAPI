// routes/user.routes.js
require("dotenv").config();
const express = require("express");
const User = require("../models/user");
const Post = require("../models/post");
const { expireVerificationIfNeeded } = require("../../services/verification.service");
const { notify } = require("../services/notificationEngine.service");

const { StreamChat } = require("stream-chat");
const { requireAuth } = require("../middleware/auth.middleware");

module.exports = (io) => {
  const express = require("express");

const router = express.Router();

const chatServer = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

const PROFILE_UPDATE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const {
  normalizeProfileStr,
  applyPendingProfileUpdates,
  syncUserProfileOnPosts,
} = require("../services/userProfile.service");

const hasScheduledProfileChanges = (user) =>
  Boolean(
    (user.pendingFirstName &&
      normalizeProfileStr(user.pendingFirstName) !==
        normalizeProfileStr(user.firstName)) ||
      (user.pendingLastName &&
        normalizeProfileStr(user.pendingLastName) !==
          normalizeProfileStr(user.lastName)) ||
      (user.pendingCompanyName &&
        normalizeProfileStr(user.pendingCompanyName) !==
          normalizeProfileStr(user.companyName)) ||
      (user.pendingCounty &&
        normalizeProfileStr(user.pendingCounty) !==
          normalizeProfileStr(user.county)) ||
      (user.pendingConstituency &&
        normalizeProfileStr(user.pendingConstituency) !==
          normalizeProfileStr(user.constituency)) ||
      (user.pendingWard &&
        normalizeProfileStr(user.pendingWard) !== normalizeProfileStr(user.ward)),
  );

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
      county,
      constituency,
      ward,
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
      const isOnboardingProfile = !normalizeProfileStr(user.nickName);

      if (isOnboardingProfile) {
        if (image) {
          user.image = image;
          user.pendingImage = undefined;
        }
        if (firstName !== undefined) {
          user.firstName = normalizeProfileStr(firstName);
        }
        if (lastName !== undefined) {
          user.lastName = normalizeProfileStr(lastName);
        }
        if (companyName !== undefined) {
          user.companyName = normalizeProfileStr(companyName);
        }
        if (nickName) user.nickName = nickName;
        if (accountType) user.accountType = accountType;
        if (provider) user.provider = provider;

        user.pendingFirstName = undefined;
        user.pendingLastName = undefined;
        user.pendingNickName = undefined;
        user.pendingCompanyName = undefined;
        user.profileUpdateAt = null;

        await user.save();
        await syncUserProfileOnPosts(user);

        return res.status(200).json({
          success: true,
          message: "Profile updated",
          user,
        });
      }

      const cooldownActive =
        user.profileUpdateAt &&
        new Date(user.profileUpdateAt).getTime() > Date.now();

      const wantsScheduledChange =
        (firstName !== undefined &&
          normalizeProfileStr(firstName) !==
            normalizeProfileStr(user.firstName)) ||
        (lastName !== undefined &&
          normalizeProfileStr(lastName) !==
            normalizeProfileStr(user.lastName)) ||
        (companyName !== undefined &&
          normalizeProfileStr(companyName) !==
            normalizeProfileStr(user.companyName)) ||
        (county !== undefined &&
          normalizeProfileStr(county) !== normalizeProfileStr(user.county)) ||
        (constituency !== undefined &&
          normalizeProfileStr(constituency) !==
            normalizeProfileStr(user.constituency)) ||
        (ward !== undefined &&
          normalizeProfileStr(ward) !== normalizeProfileStr(user.ward));

      if (cooldownActive && wantsScheduledChange) {
        return res.status(429).json({
          success: false,
          message:
            "A profile update is already scheduled. Please wait for it to go live.",
          profileUpdateAt: user.profileUpdateAt,
          user,
        });
      }

      // Photo updates go live immediately
      if (image) {
        user.image = image;
        user.pendingImage = undefined;
      }

      // Name / company updates are scheduled
      if (firstName !== undefined)
        user.pendingFirstName = normalizeProfileStr(firstName);
      if (lastName !== undefined)
        user.pendingLastName = normalizeProfileStr(lastName);
      if (nickName) user.pendingNickName = nickName;
      if (companyName !== undefined)
        user.pendingCompanyName = normalizeProfileStr(companyName);
      if (county !== undefined) user.pendingCounty = normalizeProfileStr(county);
      if (constituency !== undefined)
        user.pendingConstituency = normalizeProfileStr(constituency);
      if (ward !== undefined) user.pendingWard = normalizeProfileStr(ward);
      if (provider) user.provider = provider;
      if (accountType) user.accountType = accountType;

      if (wantsScheduledChange) {
        user.profileUpdateAt = new Date(
          Date.now() + PROFILE_UPDATE_COOLDOWN_MS,
        );
      }

      await user.save();

      // Image (and any other immediate fields) should show on existing posts right away.
      if (image) {
        await syncUserProfileOnPosts(user);
      }

      return res.status(200).json({
        success: true,
        message: hasScheduledProfileChanges(user)
          ? "Profile update scheduled"
          : "Profile updated",
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

async function resolveUserByAuth(req) {
  let user = await User.findOne({ clerkId: req.userId });
  if (user) return user;

  const email = (req.authEmail || "").trim().toLowerCase();
  if (!email) return null;

  user = await User.findOne({ email });
  if (user) {
    user.clerkId = req.userId;
    await user.save();
    return user;
  }

  return null;
}

// ------------------- UPDATE USER LOCATION -------------------
router.post("/update-location", requireAuth, async (req, res) => {
  try {
    const { county, constituency, ward } = req.body;

    let user = await resolveUserByAuth(req);

    if (!user) {
      const email = (req.authEmail || "").trim().toLowerCase();
      if (!email) {
        return res.status(404).json({
          success: false,
          message: "User not found. Complete your profile first.",
        });
      }
      user = await User.create({
        clerkId: req.userId,
        email,
        county,
        constituency,
        ward,
        provider: "google",
        accountType: "Personal Account",
      });
    } else {
      user.county = county;
      user.constituency = constituency;
      user.ward = ward;
      await user.save();
    }

    return res.status(200).json({
      success: true,
      message: "Location updated",
    });
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({
      success: false,
      message: "Server error updating location",
    });
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

    await syncUserProfileOnPosts(user);

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
