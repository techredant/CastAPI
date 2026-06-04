const express = require("express");
const User = require("../models/user");
const { verifyGoogleIdToken } = require("../services/googleAuth.service");
const { signAppToken } = require("../services/jwt.service");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();

function splitName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

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
  // Profile onboarding requires nickname (set via create-user), not Google prefilled names alone.
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

async function findOrCreateUserFromGoogle(googleProfile) {
  const email = googleProfile.email;
  let user = await User.findOne({ email });
  let isNewUser = false;

  if (user) {
    if (googleProfile.picture && !user.image) {
      user.image = googleProfile.picture;
    }
    user.provider = "google";
    await user.save();
    return { user, isNewUser: false };
  }

  const clerkId = `google_${googleProfile.sub}`;
  const fromName = splitName(googleProfile.name);
  const firstName = googleProfile.given_name || fromName.firstName;
  const lastName = googleProfile.family_name || fromName.lastName;

  user = await User.create({
    clerkId,
    email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    image: googleProfile.picture || undefined,
    provider: "google",
    accountType: "Personal Account",
  });
  isNewUser = true;
  return { user, isNewUser };
}

router.post("/google", async (req, res) => {
  try {
    const { idToken } = req.body || {};
    const googleProfile = await verifyGoogleIdToken(idToken);
    const { user, isNewUser } = await findOrCreateUserFromGoogle(googleProfile);
    const dto = userToAuthDto(user);
    if (isNewUser) {
      dto.hasCompletedName = false;
      dto.onboardingComplete = false;
    }
    const token = signAppToken({ sub: user.clerkId, email: user.email });

    return res.status(200).json({
      token,
      user: dto,
      isNewUser,
    });
  } catch (err) {
    console.error("POST /api/auth/google error:", err.message);
    const status =
      err.message?.includes("not configured") ||
      err.message?.includes("Missing")
        ? 503
        : 401;
    return res.status(status).json({
      message: err.message || "Google sign-in failed",
    });
  }
});

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
