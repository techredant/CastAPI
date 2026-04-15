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
    verifyToken: { type: String },
    verifyTokenExpiry: { type: Date },

    provider: { type: String, default: "clerk" },

    // ✅ Clerk IDs instead of ObjectIds
    followers: {
      type: [String],
      default: [],
    },
    following: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

const User = mongoose.models.User || mongoose.model("User", userSchema);
module.exports = User;
