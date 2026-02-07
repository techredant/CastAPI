// routes/user.routes.js
require("dotenv").config();
const express = require("express");
const User = require("../models/user");

const { StreamChat } = require("stream-chat");



const router = express.Router();

const chatServer = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
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
      if (provider) user.provider = provider;
      if (accountType) user.accountType = accountType;

      await user.save();
      return res
        .status(200)
        .json({ success: true, user, message: "User updated" });
    }

    user = await User.create({
      clerkId,
      email,
      firstName: firstName || "",
      lastName: lastName || "",
      nickName: nickName || "",
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

    if (!email || !firstName) {
      return res.status(400).json({ message: "Missing email or firstName" });
    }

    // --- Find or create local user ---
    let user = await User.findOne({ email });
    if (!user) {
      const id = clerkId || `user_${Date.now()}`;
      user = new User({
        clerkId: id,
        email,
        firstName,
        lastName: lastName || "",
        nickName: nickName || "",
        image: image || "",
      });
      await user.save();
    }

    // --- Upsert user in Stream ---
    await chatServer.upsertUser({
      id: user.clerkId,
      name: user.firstName,
      image: image || undefined,
    });

    // --- Generate tokens ---
    const chatToken = chatServer.createToken(user.clerkId);
    const videoToken = await createVideoToken(user.clerkId);

    res.json({ user, chatToken, videoToken });
  } catch (err) {
    console.error("Error in create-or-get-user:", err);
    res.status(500).json({ message: "Server error", error: err.message });
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
      { new: true }
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
      { new: true }
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


// // ------------------- FOLLOW -------------------
// router.post("/:clerkId/follow/:targetClerkId", async (req, res) => {
//   try {
//     const { clerkId, targetClerkId } = req.params;

//     if (clerkId === targetClerkId) {
//       return res.status(400).json({ error: "You cannot follow yourself" });
//     }

//     const user = await User.findOne({ clerkId });
//     const target = await User.findOne({ clerkId: targetClerkId });

//     if (!user || !target) {
//       return res.status(404).json({ error: "User not found" });
//     }

//     // Prevent duplicate follow
//     if (!target.followers.includes(clerkId)) {
//       target.followers.push(clerkId);
//       await target.save();
//     }

//     // Add to current user's following list
//     if (!user.following.includes(targetClerkId)) {
//       user.following.push(targetClerkId);
//       await user.save();
//     }

//     res.json({ success: true, message: "Followed successfully", target });
//   } catch (error) {
//     console.error("Error following:", error);
//     res.status(500).json({ error: "Server error" });
//   }
// });

// // ------------------- UNFOLLOW -------------------
// router.post("/:clerkId/unfollow/:targetClerkId", async (req, res) => {
//   try {
//     const { clerkId, targetClerkId } = req.params;

//     const user = await User.findOne({ clerkId });
//     const target = await User.findOne({ clerkId: targetClerkId });

//     if (!user || !target) {
//       return res.status(404).json({ error: "User not found" });
//     }

//     target.followers = target.followers.filter((id) => id !== clerkId);
//     user.following = user.following.filter((id) => id !== targetClerkId);

//     await target.save();
//     await user.save();

//     res.json({ success: true, message: "Unfollowed successfully", target });
//   } catch (error) {
//     console.error("Error unfollowing:", error);
//     res.status(500).json({ error: "Server error" });
//   }
// });


// ------------------- GET ALL USERS -------------------
router.get("/", async (req, res) => {
  try {
    const { clerkId } = req.query; // 👈 current logged-in user's Clerk ID (optional)

    const users = await User.find();

    // If no logged-in user provided, return all users
    if (!clerkId) {
      return res.json(users);
    }

    // Get the current user for following info
    const currentUser = await User.findOne({ clerkId });

    const data = users.map((u) => ({
      _id: u._id,
      clerkId: u.clerkId,
      firstName: u.firstName,
      lastName: u.lastName,
      nickName: u.nickName,
      image: u.image,
      county: u.county,
      constituency: u.constituency,
      ward: u.ward,
      followers: u.followers,
      following: u.following,
      isFollowing: currentUser?.following?.includes(u.clerkId) || false,
    }));

    res.json(data);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Server error fetching users" });
  }
});

module.exports = router;
