const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  userId: String, // receiver
  type: String, // like, follow, comment
  postId: String,

  actors: [
    {
      userId: String,
      name: String,
      image: String,
    },
  ],

  count: { type: Number, default: 1 },

  isRead: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Notification", notificationSchema);
