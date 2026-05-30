const mongoose = require("mongoose");

const advertiserSchema = new mongoose.Schema(
  {
    clerkId: { type: String, required: true, unique: true, index: true },
    businessName: { type: String, required: true },
    businessLogo: { type: String },
    businessCategory: { type: String },
    website: { type: String },
    phone: { type: String },
    email: { type: String },
    description: { type: String },
    isVerified: { type: Boolean, default: false },
    walletBalance: { type: Number, default: 0, min: 0 },
    totalSpend: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    banReason: { type: String },
    bannedAt: { type: Date },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.Advertiser ||
  mongoose.model("Advertiser", advertiserSchema);
