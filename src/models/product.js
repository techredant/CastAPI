const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, index: "text" },
    price: { type: Number, required: true, index: true },
    phoneNumber: { type: Number, required: true },
    description: { type: String, required: true },
    media: { type: [String], default: [] },
    category: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    condition: {
      type: String,
      enum: ["new", "used"],
      default: "used",
    },
    location: {
      county: { type: String, index: true },
      constituency: { type: String },
      ward: { type: String },
    },
    status: {
      type: String,
      enum: ["active", "sold", "hidden", "flagged"],
      default: "active",
      index: true,
    },
    isPromoted: { type: Boolean, default: false, index: true },
    boostExpiresAt: { type: Date, default: null, index: true },
    boostRankWeight: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    favoriteCount: { type: Number, default: 0 },
    chatCount: { type: Number, default: 0 },
    listingType: {
      type: String,
      enum: ["free", "boosted"],
      default: "free",
    },
    fraudFlags: {
      score: { type: Number, default: 0 },
      warnings: [{ type: String }],
    },
  },
  { timestamps: true },
);

productSchema.index({ title: "text", description: "text" });
productSchema.index({ createdAt: -1 });
productSchema.index({ boostExpiresAt: -1, boostRankWeight: -1 });

const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);

module.exports = Product;
