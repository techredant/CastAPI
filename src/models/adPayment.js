const mongoose = require("mongoose");

const adPaymentSchema = new mongoose.Schema(
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
    },
    advertiserClerkId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "KES" },
    method: {
      type: String,
      enum: ["mpesa", "card", "wallet"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
      index: true,
    },
    invoiceNumber: { type: String, unique: true, sparse: true },
    mpesaCheckoutRequestId: { type: String },
    mpesaMerchantRequestId: { type: String },
    cardReference: { type: String },
    walletTransactionId: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.AdPayment || mongoose.model("AdPayment", adPaymentSchema);
