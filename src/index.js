// const express = require("express");
// const mongoose = require("mongoose");
// const cors = require("cors");
// const http = require("http");
// const { Server } = require("socket.io");
// require("dotenv").config();


// const app = express();
// const server = http.createServer(app);

// const io = new Server(server, {
//   cors: {
//     origin: "*",
//     methods: ["GET", "POST", "DELETE"],
//   },
// });

// app.use(cors());
// app.use(express.json());

// app.get("/", (req, res) => {
//   res.status(200).json({ message: "Success" });
// });
// // ✅ Socket.IO handling
// io.on("connection", (socket) => {
//   console.log("🟢 Client connected:", socket.id);

//   socket.on("joinRoom", (room) => {
//     socket.join(room);
//     console.log(`User ${socket.id} joined room: ${room}`);
//   });

//   socket.on("leaveRoom", (room) => {
//     socket.leave(room);
//     console.log(`User ${socket.id} left room: ${room}`);
//   });

//   socket.on("disconnect", () => {
//     console.log("🔴 Client disconnected:", socket.id);
//   });
// });

// const userRoutes = require("./routes/user.routes");
// const postRoutes = require("./routes/post.routes")(io);
// const productRoutes = require("./routes/product.routes");
// // const newsRoutes = require("./routes/news.routes");
// const aiRoutes = require("./routes/ai.routes")
// const upsertRoutes = require("./routes/upsertai.routes")

// const streamRoutes = require("./routes/stream.routes");

// app.use("/api/ai-reply", aiRoutes);
// app.use("/api/upsert",  upsertRoutes);
// app.use("/api/users", userRoutes);
// app.use("/api/posts", postRoutes);
// app.use("/api/products", productRoutes);
// // app.use("/api/news", newsRoutes);

// app.use("/api/stream", streamRoutes);

// const PORT = 3000;

// mongoose
//   .connect(process.env.MONGO_URI)
//   .then(() => {
//     console.log("✅ MongoDB connectedsdklsdj");

//     app.listen(PORT, () => {
//       console.log(`🚀 Server is running weiugr on http://localhost:${PORT}`);
//     });
//   })
//   .catch((err) => {
//     console.error("❌ MongoDB connection error:", err.message);
//   });


const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

// ---------------- MIDDLEWARE ----------------
app.use(cors());
app.use(express.json());

// ---------------- ROUTES ----------------
const aiRoutes = require("./routes/ai.routes");
const upsertRoutes = require("./routes/upsertai.routes");
const streamRoutes = require("./routes/stream.routes");
const userRoutes = require("./routes/user.routes");
const productRoutes = require("./routes/product.routes");
const postRoutes = require("./routes/post.routes");

// 🔥 Stream webhook MUST be early
app.use("/api/ai-reply", aiRoutes);
app.use("/api/upsert", upsertRoutes);
app.use("/api/stream", streamRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);

// ---------------- SOCKET.IO ----------------
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "DELETE"] },
});

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);
});

// ---------------- ROOT ----------------
app.get("/", (_, res) => {
  res.json({ status: "OK" });
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Mongo error:", err.message);
  });
