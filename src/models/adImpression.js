const mongoose = require("mongoose");

const adImpressionSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },
    viewerClerkId: { type: String, index: true },
    sessionId: { type: String },
    levelType: { type: String },
    levelValue: { type: String },
    watchTimeMs: { type: Number, default: 0 },
    isFraudSuspect: { type: Boolean, default: false },
  },
  { timestamps: true },
);

adImpressionSchema.index({ adId: 1, viewerClerkId: 1, createdAt: -1 });
adImpressionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports =
  mongoose.models.AdImpression ||
  mongoose.model("AdImpression", adImpressionSchema);
