const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dns = require("dns");
const http = require("http");
const os = require("os");
const { Server } = require("socket.io");
const { StreamChat } = require("stream-chat");
require("dotenv").config();

// Windows: Node's default resolver often fails mongodb+srv (querySrv ECONNREFUSED).
const mongoDns = process.env.MONGO_DNS_SERVERS?.split(",").map((s) => s.trim()).filter(Boolean);
if (mongoDns?.length) {
  dns.setServers(mongoDns);
} else if (process.platform === "win32" && String(process.env.MONGO_URI || "").startsWith("mongodb+srv://")) {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

const User = require("./models/user");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  },
  transports: ["polling", "websocket"],
  pingInterval: 25000,
  pingTimeout: 60000,
});

app.set("io", io);
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).json({ message: "Success" });
});

const {
  heartbeat: presenceHeartbeat,
  queryOnlineUserIds,
  allOnlineUserIds,
} = require("./services/presence.service");

/** userId -> active socket count (instant push when Socket.IO is available) */
const presenceCounts = new Map();

function markUserOnline(userId) {
  const prev = presenceCounts.get(userId) || 0;
  presenceCounts.set(userId, prev + 1);
  if (prev === 0) {
    io.emit("presence:online", { userId });
  }
}

function markUserOffline(userId) {
  const next = (presenceCounts.get(userId) || 1) - 1;
  if (next <= 0) {
    presenceCounts.delete(userId);
    io.emit("presence:offline", { userId });
  } else {
    presenceCounts.set(userId, next);
  }
}

// ✅ Socket.IO handling
io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);

  // 📌 existing room system (KEEP THIS)
  socket.on("joinRoom", (room) => {
    if (typeof room !== "string" || !room.trim()) return;
    socket.join(room.trim());
    console.log(`Joined feed room: ${room}`);
  });

  socket.on("joinRooms", (rooms) => {
    if (!Array.isArray(rooms)) return;
    const joined = [];
    for (const room of rooms) {
      if (typeof room !== "string" || !room.trim()) continue;
      const name = room.trim();
      socket.join(name);
      joined.push(name);
    }
    if (joined.length) {
      console.log(`Joined ${joined.length} feed room(s)`, joined.slice(0, 5));
    }
    socket.emit("roomsJoined", joined);
  });

  // 🔥 Notifications + presence (same user room)
  socket.on("join", (userId) => {
    if (typeof userId !== "string" || !userId.trim()) return;
    const id = userId.trim();
    socket.data.presenceUserId = id;
    socket.join(id);
    markUserOnline(id);
    void presenceHeartbeat(id).catch(() => {});
    void allOnlineUserIds()
      .then((onlineUserIds) => {
        socket.emit("presence:snapshot", { onlineUserIds });
      })
      .catch(() => {
        socket.emit("presence:snapshot", { onlineUserIds: [id] });
      });
    console.log(`🔔 User joined notification room: ${id}`);
  });

  socket.on("presence:query", (userIds) => {
    if (!Array.isArray(userIds)) return;
    void queryOnlineUserIds(userIds)
      .then((onlineUserIds) => {
        socket.emit("presence:batch", { onlineUserIds });
      })
      .catch(() => {
        socket.emit("presence:batch", { onlineUserIds: [] });
      });
  });

  socket.on("leaveRoom", (room) => {
    socket.leave(room);
  });

  socket.on("joinLiveRoom", (callId) => {
    if (typeof callId !== "string" || !callId.trim()) return;
    const room = `live:${callId.trim()}`;
    socket.join(room);
    socket.data.liveCallId = callId.trim();
  });

  socket.on("leaveLiveRoom", (callId) => {
    if (typeof callId !== "string" || !callId.trim()) return;
    socket.leave(`live:${callId.trim()}`);
    if (socket.data.liveCallId === callId.trim()) {
      delete socket.data.liveCallId;
    }
  });

  socket.on("disconnect", () => {
    const userId = socket.data.presenceUserId;
    if (userId) {
      markUserOffline(userId);
    }
    console.log("🔴 Client disconnected:", socket.id);
  });
});

const userRoutes = require("./routes/user.routes")(io);
const postRoutes = require("./routes/post.routes")(io);
const productRoutes = require("./routes/product.routes");
const marketplaceRoutes = require("./routes/marketplace.routes");
const aiRoutes = require("./routes/ai.routes");
const aiFeedRoutes = require("./routes/aiFeed.routes");
const aiSearchRoutes = require("./routes/aiSearch.routes");
const aiModerationRoutes = require("./routes/aiModeration.routes");
const aiAnalyticsRoutes = require("./routes/aiAnalytics.routes");
const streamRoutes = require("./routes/stream.routes");
const statusRoutes = require("./routes/status.routes");
const commentRoutes = require("./routes/comment.routes")(io);
const dashboardRoutes = require("./routes/dashboard.routes");
const notificationsRoutesFactory = require("./routes/notifications.routes");
const verificationRoutes = require("./routes/verification.routes")(io);
const liveRoutes = require("./routes/live.routes")(io);
const agoraRoutes = require("./routes/agora.routes")(io);
const mediaRoutes = require("./routes/media.routes")();
const adsRoutes = require("./routes/ads.routes")();
const advertiserRoutes = require("./routes/advertiser.routes")();
const adsAdminRoutes = require("./routes/adsAdmin.routes")();
const mpesaRoutes = require("./routes/mpesa.routes")(io);
const pollRoutes = require("./routes/poll.routes")(io);
const presenceRoutes = require("./routes/presence.routes");
const notificationsRoutes = notificationsRoutesFactory(io);
const { notify } = require("./services/notificationEngine.service");
const aiRateLimit = require("./middleware/aiRateLimit");
const {
  closeExpiredPolls,
  notifyPollEndingSoon,
  refreshTrendingScores,
} = require("./services/poll.service");

app.set("notificationNotify", notify);

app.use("/api/users", userRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/products", productRoutes);
app.use("/api/marketplace", marketplaceRoutes());
app.use("/api/stream", streamRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/ai", aiRateLimit(), aiRoutes);
app.use("/api/ai/feed", aiRateLimit(), aiFeedRoutes);
app.use("/api/ai/search", aiRateLimit(), aiSearchRoutes);
app.use("/api/ai/moderation", aiRateLimit(), aiModerationRoutes);
app.use("/api/ai/audit", aiRateLimit(), aiAnalyticsRoutes);
app.use("/api/notification-token", notificationsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/verification", verificationRoutes);
app.use("/api/live", liveRoutes);
app.use("/api/agora", agoraRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/advertiser", advertiserRoutes);
app.use("/api/ads-admin", adsAdminRoutes);
app.use("/api/mpesa", mpesaRoutes);
app.use("/api/polls", pollRoutes);
app.use("/api/presence", presenceRoutes());

const PORT = Number(process.env.PORT) || 3000;
const POLL_MAINTENANCE_MS = 5 * 60 * 1000;

function getLanIPv4() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");

    // Initialize Stream Chat server client
    const serverClient = StreamChat.getInstance(
      process.env.STREAM_API_KEY,
      process.env.STREAM_API_SECRET,
    );

    server.listen(PORT, "0.0.0.0", () => {
      const lan = getLanIPv4();
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
      if (lan) {
        console.log(`   On your phone, set EXPO_PUBLIC_API_URL_DEV=http://${lan}:${PORT}`);
      }
    });

    const runPollMaintenance = async () => {
      try {
        await closeExpiredPolls(notify, io);
        await notifyPollEndingSoon(notify, io);
        await refreshTrendingScores();
      } catch (err) {
        console.error("poll maintenance:", err.message);
      }
    };

    void runPollMaintenance();
    setInterval(runPollMaintenance, POLL_MAINTENANCE_MS);
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
  });
