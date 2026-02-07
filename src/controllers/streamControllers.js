const axios = require("axios");
const User = require("../models/user");
const Room = require("../models/room");
const { StreamChat } = require("stream-chat");

const chatServer = StreamChat.getInstance(
  process.env.STREAM_CHAT_KEY,
  process.env.STREAM_CHAT_SECRET
);

const STREAM_VIDEO_API = "https://video.stream-io-api.com/video/v1";
const STREAM_VIDEO_KEY = process.env.STREAM_VIDEO_KEY;
const STREAM_VIDEO_SECRET = process.env.STREAM_VIDEO_SECRET;

// Create video token
const createVideoToken = async (userId) => {
  const resp = await axios.post(
    `${STREAM_VIDEO_API}/tokens`,
    { user_id: userId },
    { auth: { username: STREAM_VIDEO_KEY, password: STREAM_VIDEO_SECRET } }
  );
  return resp.data.token;
};

// Create/get user + tokens
exports.createOrGetUser = async (req, res) => {
  try {
    const { email, firstName, lastName, nickName, image } = req.body;

    if (!email || !firstName) {
      return res
        .status(400)
        .json({ message: "Missing fields: email or firstName" });
    }

    // --- Find or create local user ---
    let user = await User.findOne({ email });
    if (!user) {
      const clerkId = `user_${Date.now()}`;
      user = new User({ email, firstName, lastName, nickName, clerkId });
      await user.save();
    }

    // --- Upsert user in Stream Chat ---
    await chatServer.upsertUser({
      id: user.clerkId, // must match the user ID you use for token
      name: user.firstName,
      image: image || undefined,
    });

    // --- Generate Stream Chat token ---
    const chatToken = chatServer.createToken(user.clerkId);

    // --- Generate Stream Video token ---
    const videoToken = await createVideoToken(user.clerkId);

    res.json({ user, chatToken, videoToken });
  } catch (err) {
    console.error("Error in createOrGetUser:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};



// Create room
exports.createRoom = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Room name required" });

    const streamRoomId = `room_${Date.now()}`;
    const room = new Room({ name, streamRoomId, participants: [] });
    await room.save();
    res.json({ room });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Join room
exports.joinRoom = async (req, res) => {
  try {
    const { streamRoomId, streamUserId } = req.body;
    if (!streamRoomId || !streamUserId)
      return res.status(400).json({ message: "Missing fields" });

    const room = await Room.findOne({ streamRoomId });
    if (!room) return res.status(404).json({ message: "Room not found" });

    if (!room.participants.includes(streamUserId)) {
      room.participants.push(streamUserId);
      await room.save();
    }

    const videoToken = await createVideoToken(streamUserId);
    res.json({ room, videoToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
