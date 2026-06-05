const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    clerkId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
    nickName: { type: String, unique: true },
    image: { type: String },
    accountType: { type: String },
    companyName: { type: String },

    // 🟢 IEBC Location
    home: { type: String, default: "Home" },
    county: { type: String },
    constituency: { type: String },
    ward: { type: String },

    isVerified: { type: Boolean, default: false },
    verificationType: {
      type: String,
      enum: ["personal", "business", "government"],
      default: undefined,
    },
    verifiedAt: { type: Date, default: null },
    verificationExpiresAt: { type: Date, default: null },
    activeVerificationRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VerificationRequest",
      default: null,
    },
    role: { type: String, enum: ["user", "admin"], default: "user" },

    verifyToken: { type: String },
    verifyTokenExpiry: { type: Date },

     // ---------------- PENDING UPDATES ----------------
     pendingFirstName: { type: String },
     pendingLastName: { type: String },
     pendingNickName: { type: String },
     pendingImage: { type: String },
     pendingCompanyName: { type: String },
     pendingCounty: { type: String },
     pendingConstituency: { type: String },
     pendingWard: { type: String },

     profileUpdateAt: { type: Date, default: null },

    provider: { type: String, default: "google" },

    // ✅ Clerk IDs instead of ObjectIds
    followers: {
      type: [String],
      default: [],
    },
    following: {
      type: [String],
      default: [],
    },
    expoPushToken: {
      type: String,
      default: null,
    },

    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    isPremiumSeller: { type: Boolean, default: false },
    aiBadges: { type: [String], default: [] },
    aiTrustScore: { type: Number, default: 0.5, index: true },
    aiInterestUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ county: 1, constituency: 1, ward: 1 });
userSchema.index({ firstName: "text", lastName: "text", nickName: "text", companyName: "text" });

const User = mongoose.models.User || mongoose.model("User", userSchema);
module.exports = User;
