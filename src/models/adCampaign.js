const mongoose = require("mongoose");
const { CAMPAIGN_STATUSES } = require("../config/adPricing");

const targetingSchema = new mongoose.Schema(
  {
    countries: [{ type: String }],
    counties: [{ type: String }],
    cities: [{ type: String }],
    ageMin: { type: Number, min: 13, max: 100 },
    ageMax: { type: Number, min: 13, max: 100 },
    genders: [{ type: String, enum: ["male", "female", "other", "all"] }],
    interests: [{ type: String }],
    marketplaceBehaviors: [{ type: String }],
  },
  { _id: false },
);

const adCampaignSchema = new mongoose.Schema(
  {
    advertiserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Advertiser",
      required: true,
      index: true,
    },
    advertiserClerkId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    status: {
      type: String,
      enum: CAMPAIGN_STATUSES,
      default: "pending_review",
      index: true,
    },
    budgetTotal: { type: Number, required: true, min: 0 },
    budgetSpent: { type: Number, default: 0, min: 0 },
    dailyBudget: { type: Number },
    planId: { type: String },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true, index: true },
    targeting: { type: targetingSchema, default: () => ({}) },
    moderationNotes: { type: String },
    rejectionReason: { type: String },
    approvedAt: { type: Date },
    approvedBy: { type: String },
    pausedAt: { type: Date },
    completedAt: { type: Date },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "paid", "refunded"],
      default: "unpaid",
    },
    impressionsDelivered: { type: Number, default: 0 },
    clicksDelivered: { type: Number, default: 0 },
  },
  { timestamps: true },
);

adCampaignSchema.index({ status: 1, startsAt: 1, endsAt: 1 });
adCampaignSchema.index({ advertiserClerkId: 1, status: 1 });

module.exports =
  mongoose.models.AdCampaign || mongoose.model("AdCampaign", adCampaignSchema);
