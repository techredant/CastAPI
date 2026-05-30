const mongoose = require("mongoose");

const sellerSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    planId: { type: String, default: "premium_seller" },
    amount: { type: Number, required: true },
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
  mongoose.models.SellerSubscription ||
  mongoose.model("SellerSubscription", sellerSubscriptionSchema);
