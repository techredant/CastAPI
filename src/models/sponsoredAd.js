const mongoose = require("mongoose");
const { AD_CTA_TYPES, AD_MEDIA_TYPES } = require("../config/adPricing");

const mediaItemSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    type: { type: String, enum: ["image", "video"], default: "image" },
    thumbnailUrl: { type: String },
  },
  { _id: false },
);

const sponsoredAdSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdCampaign",
      required: true,
      index: true,
    },
    advertiserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Advertiser",
      required: true,
      index: true,
    },
    advertiserClerkId: { type: String, required: true, index: true },
    businessName: { type: String, required: true },
    businessLogo: { type: String },
    isVerified: { type: Boolean, default: false },
    label: {
      type: String,
      enum: ["Sponsored", "Promoted"],
      default: "Sponsored",
    },
    mediaType: {
      type: String,
      enum: AD_MEDIA_TYPES,
      default: "image",
    },
    media: { type: [mediaItemSchema], default: [] },
    caption: { type: String, maxlength: 2000 },
    ctaType: { type: String, enum: AD_CTA_TYPES, default: "learn_more" },
    ctaLabel: { type: String },
    ctaUrl: { type: String },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    isActive: { type: Boolean, default: true, index: true },
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },
    saveCount: { type: Number, default: 0 },
    hiddenByUsers: { type: [String], default: [] },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.SponsoredAd ||
  mongoose.model("SponsoredAd", sponsoredAdSchema);
