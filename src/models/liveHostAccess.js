const mongoose = require("mongoose");

const liveHostAccessSchema = new mongoose.Schema(
  {
    clerkId: { type: String, required: true, index: true },
    callId: { type: String, required: true, index: true },
    streamKind: {
      type: String,
      enum: ["community", "market"],
      required: true,
    },
    roomTitle: { type: String },
    productId: { type: String },
    amount: { type: Number, required: true },
    phoneNumber: { type: String },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
      index: true,
    },
    mpesaCheckoutRequestId: { type: String, index: true },
    mpesaMerchantRequestId: { type: String },
    paidAt: { type: Date },
    expiresAt: { type: Date, index: true },
  },
  { timestamps: true },
);

liveHostAccessSchema.index({ clerkId: 1, callId: 1, status: 1 });

module.exports =
  mongoose.models.LiveHostAccess ||
  mongoose.model("LiveHostAccess", liveHostAccessSchema);
