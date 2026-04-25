// routes/user.routes.js
require("dotenv").config();
const express = require("express");
const User = require("../models/user");
const Post = require("../models/post");
const Notification = require("../models/notifications");


const { StreamChat } = require("stream-chat");

module.exports = (io) => {
  const express = require("express");

const router = express.Router();

const chatServer = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
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
      provider,
      accountType,
    } = req.body;

    if (!clerkId || !email) {
      return res.status(400).json({ message: "Missing clerkId or email" });
    }

    let user = await User.findOne({ clerkId });

 if (user) {
   if (firstName) user.firstName = firstName;
   if (lastName) user.lastName = lastName;
   if (nickName) user.nickName = nickName;
   if (image) user.image = image;
   if (companyName) user.companyName = companyName;
   if (provider) user.provider = provider;
   if (accountType) user.accountType = accountType;

   await user.save();

   // 🔥 UPDATE POSTS
   await Post.updateMany(
     { userId: clerkId },
     {
       $set: {
         "user.firstName": user.firstName,
         "user.lastName": user.lastName,
         "user.nickName": user.nickName,
         "user.image": user.image,
         "user.accountType": user.accountType,
       },
     },
   );

   // 🔥 SOCKET EMIT (MUST BE BEFORE RETURN)
   io?.emit?.("userUpdated", {
     clerkId,
     firstName: user.firstName,
     lastName: user.lastName,
     nickName: user.nickName,
     image: user.image,
     accountType: user.accountType,
   });

   return res.status(200).json({
     success: true,
     user,
     message: "User updated + posts synced",
   });
 }
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

    res.status(201).json({ success: true, user, message: "User created" });
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
    const videoToken = await createVideoToken(user.clerkId);

    res.json({ user, chatToken, videoToken });
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
    const user = await User.findOne({ clerkId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("Error fetching user:", err);
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
     const follower = await User.findOne({ clerkId });

     // 🔍 Find existing follow notification
     let existing = await Notification.findOne({
       userId: targetClerkId,
       type: "follow",
     });

     if (existing) {
       const alreadyIncluded = existing.actors.some(
         (a) => a.userId === clerkId,
       );

       if (!alreadyIncluded) {
         existing.actors.unshift({
           userId: clerkId,
           name: follower?.firstName,
           image: follower?.image,
         });

         existing.count += 1;
         existing.isRead = false;

         await existing.save();
       }
     } else {
       existing = await Notification.create({
         userId: targetClerkId,
         type: "follow",
         actors: [
           {
             userId: clerkId,
             name: follower?.firstName,
             image: follower?.image,
           },
         ],
         count: 1,
       });
     }

     // 🔥 emit to USER ROOM
     io.to(targetClerkId).emit("newNotification", existing);

     // optional push
     if (target?.pushToken) {
       await sendPushNotification(
         target.pushToken,
         "New Follower 👤",
         `${follower?.firstName || "Someone"} followed you`,
       );
     }
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const { clerkId, cursor } = req.query;

    const limit = 20;

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
      .limit(limit)
      .select(
        "clerkId firstName lastName nickName image county constituency ward followers following",
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
      image: u.image,
      county: u.county,
      constituency: u.constituency,
      ward: u.ward,
    }));

    // ---------------------------
    // NEXT CURSOR
    // ---------------------------
    const nextCursor =
      users.length === limit ? users[users.length - 1]._id : null;

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

    const limit = 20;

    const filter = {
      ...(clerkId && { clerkId: { $ne: clerkId } }),
      $or: [
        { firstName: { $regex: query, $options: "i" } },
        { lastName: { $regex: query, $options: "i" } },
        { nickName: { $regex: query, $options: "i" } },
      ],
    };

    if (cursor) {
      filter._id = { $lt: cursor };
    }

    const users = await User.find(filter).sort({ _id: -1 }).limit(limit);

    let currentUser = null;

    if (clerkId) {
      currentUser = await User.findOne({ clerkId }).select("following");
    }

   const formatted = users.map((u) => ({
     id: u._id,
     clerkId: u.clerkId,
     name:
       `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() ||
       u.nickName ||
       "Unknown User",
     image: u.image,
   }));

    const nextCursor =
      users.length === limit ? users[users.length - 1]._id : null;

    res.json({
      users: formatted,
      nextCursor,
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
return router;
}
