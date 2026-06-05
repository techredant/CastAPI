const express = require("express");
const User = require("../models/user");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();

function isPersonalAccountType(accountType) {
  const t = (accountType || "").trim();
  if (!t || t === "Personal Account" || t.toLowerCase() === "personal") {
    return true;
  }
  return !/organization|business|non-profit|public figure|media|e-commerce|entertainment/i.test(
    t,
  );
}

function userToAuthDto(user) {
  const isPersonal = isPersonalAccountType(user.accountType);
  const hasName = isPersonal
    ? Boolean(user.firstName?.trim() && user.lastName?.trim())
    : Boolean(user.companyName?.trim());
  const hasNick = Boolean(user.nickName?.trim());
  const hasCompletedName = hasNick && hasName;
  const hasLocation = Boolean(
    user.county?.trim() && user.constituency?.trim() && user.ward?.trim(),
  );
  const displayName = isPersonal
    ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
    : (user.companyName || "").trim();

  return {
    clerkId: user.clerkId,
    email: user.email,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    image: user.image || null,
    nickName: user.nickName || "",
    accountType: user.accountType || "Personal Account",
    county: user.county || null,
    constituency: user.constituency || null,
    ward: user.ward || null,
    hasCompletedName,
    onboardingComplete: isPersonal
      ? hasCompletedName && hasLocation
      : hasCompletedName,
    displayName: displayName || user.email?.split("@")[0] || "Member",
  };
}

router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: req.userId });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json({ user: userToAuthDto(user) });
  } catch (err) {
    console.error("GET /api/auth/me error:", err.message);
    return res.status(500).json({ message: "Failed to load profile" });
  }
});

module.exports = router;
