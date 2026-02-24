const mongoose = require("mongoose");

const newsSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  image: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("News", newsSchema);
