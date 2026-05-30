const mongoose = require("mongoose");

const aiFeatureFlagSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    description: { type: String, default: "" },
    rolloutPercent: { type: Number, default: 100 },
    updatedBy: String,
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.AiFeatureFlag ||
  mongoose.model("AiFeatureFlag", aiFeatureFlagSchema);
