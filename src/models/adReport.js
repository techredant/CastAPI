const mongoose = require("mongoose");
const { MODERATION_REASONS } = require("../config/adPricing");

const adReportSchema = new mongoose.Schema(
  {
    adId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SponsoredAd",
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdCampaign",
      index: true,
    },
    reporterClerkId: { type: String, required: true, index: true },
    reason: { type: String, enum: MODERATION_REASONS, required: true },
    details: { type: String },
    status: {
      type: String,
      enum: ["open", "reviewed", "action_taken"],
      default: "open",
    },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.AdReport || mongoose.model("AdReport", adReportSchema);
