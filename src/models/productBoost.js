const mongoose = require("mongoose");

const productBoostSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    planId: { type: String, required: true },
    amount: { type: Number, required: true },
    rankWeight: { type: Number, default: 50 },
    status: {
      type: String,
      enum: ["pending_payment", "active", "expired", "cancelled"],
      default: "pending_payment",
    },
    startsAt: { type: Date },
    expiresAt: { type: Date, index: true },
    mpesaCheckoutRequestId: { type: String },
    mpesaMerchantRequestId: { type: String },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.ProductBoost ||
  mongoose.model("ProductBoost", productBoostSchema);
