const mongoose = require("mongoose");

const verificationRequestSchema = new mongoose.Schema(
  {
    clerkId: { type: String, required: true, index: true },
    verificationType: {
      type: String,
      enum: ["personal", "business", "government"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "pending_payment",
        "pending_review",
        "approved",
        "rejected",
        "payment_failed",
        "revoked",
        "expired",
      ],
      default: "pending_payment",
      index: true,
    },

    billingCycle: {
      type: String,
      enum: ["monthly", "yearly"],
      default: "yearly",
    },

    // Application
    fullName: { type: String, required: true },
    businessName: { type: String, default: "" },
    idNumber: { type: String, default: "" },
    website: { type: String, default: "" },
    applicationReason: { type: String, default: "" },
    documentUrls: { type: [String], default: [] },

    // Payment
    amount: { type: Number, required: true },
    currency: { type: String, default: "KES" },
    phoneNumber: { type: String, required: true },
    paymentReference: { type: String, index: true },
    mpesaCheckoutRequestId: { type: String, index: true },
    mpesaMerchantRequestId: { type: String },
    paidAt: { type: Date },

    // Review
    reviewedAt: { type: Date },
    reviewedBy: { type: String, default: "" },
    rejectionReason: { type: String, default: "" },
    adminNotes: { type: String, default: "" },

    expiresAt: { type: Date },
  },
  { timestamps: true },
);

verificationRequestSchema.index(
  { clerkId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["pending_payment", "pending_review"] },
    },
  },
);

const VerificationRequest =
  mongoose.models.VerificationRequest ||
  mongoose.model("VerificationRequest", verificationRequestSchema);

module.exports = VerificationRequest;
