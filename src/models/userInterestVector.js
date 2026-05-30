const mongoose = require("mongoose");

const userInterestVectorSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    vector: { type: [Number], default: [] },
    topTopics: [
      {
        topic: String,
        weight: Number,
      },
    ],
    counties: [
      {
        county: String,
        weight: Number,
      },
    ],
    lastBuiltAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.UserInterestVector ||
  mongoose.model("UserInterestVector", userInterestVectorSchema);
