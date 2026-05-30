const mongoose = require("mongoose");

const adClickSchema = new mongoose.Schema(
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
    clickType: {
      type: String,
      enum: ["cta", "profile", "media", "product"],
      default: "cta",
    },
    isFraudSuspect: { type: Boolean, default: false },
  },
  { timestamps: true },
);

adClickSchema.index({ adId: 1, viewerClerkId: 1, createdAt: -1 });

module.exports =
  mongoose.models.AdClick || mongoose.model("AdClick", adClickSchema);
