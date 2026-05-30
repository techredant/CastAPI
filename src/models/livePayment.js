const mongoose = require("mongoose");

const livePaymentSchema = new mongoose.Schema(
  {
    clerkId: { type: String, required: true, index: true },
    callId: { type: String, required: true, index: true },
    hostUserId: { type: String, index: true },
    type: { type: String, enum: ["gift", "donation"], required: true },
    giftId: { type: String },
    amount: { type: Number, required: true },
    phoneNumber: { type: String },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    mpesaCheckoutRequestId: { type: String, index: true },
    mpesaMerchantRequestId: { type: String },
    senderName: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model("LivePayment", livePaymentSchema);
