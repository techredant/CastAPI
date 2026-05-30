const mongoose = require("mongoose");

const adDailyAnalyticsSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdCampaign",
      required: true,
      index: true,
    },
    adId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SponsoredAd",
      index: true,
    },
    date: { type: String, required: true, index: true },
    impressions: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 },
    engagements: { type: Number, default: 0 },
    videoWatchTimeMs: { type: Number, default: 0 },
    spend: { type: Number, default: 0 },
  },
  { timestamps: true },
);

adDailyAnalyticsSchema.index({ campaignId: 1, date: 1 }, { unique: true });

module.exports =
  mongoose.models.AdDailyAnalytics ||
  mongoose.model("AdDailyAnalytics", adDailyAnalyticsSchema);
