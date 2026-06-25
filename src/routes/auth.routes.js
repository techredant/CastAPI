const express = require("express");
const User = require("../models/user");
const { verifyGoogleIdToken } = require("../services/googleAuth.service");
const { signAppToken } = require("../services/jwt.service");
const {
  applyPendingProfileUpdates,
  userToAuthDto,
} = require("../services/userProfile.service");
const { normalizeEmail } = require("../services/googleAuth.service");
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

async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const exact = await User.findOne({ email: normalized });
  if (exact) return exact;

  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return User.findOne({
    email: { $regex: new RegExp(`^${escaped}$`, "i") },
  });
}

async function findOrCreateUserFromGoogle(googleProfile) {
  const email = normalizeEmail(googleProfile.email);
  const googleClerkId = `google_${googleProfile.sub}`;
  let user =
    (await findUserByEmail(email)) ||
    (await User.findOne({ clerkId: googleClerkId }));
  let isNewUser = false;

  if (user) {
    if (normalizeEmail(user.email) !== email) {
      user.email = email;
    }
    if (googleProfile.picture && !user.image) {
      user.image = googleProfile.picture;
    }
    user.provider = "google";
    await user.save();
    return { user, isNewUser: false };
  }

  const clerkId = googleClerkId;
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
    await applyPendingProfileUpdates(user);
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
    if (err?.code === 11000) {
      return res.status(409).json({
        message:
          "An account with this email already exists. Try signing in with the email you used before.",
      });
    }
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
    let user = await User.findOne({ clerkId: req.userId });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    user = await applyPendingProfileUpdates(user);
    return res.status(200).json({ user: userToAuthDto(user) });
  } catch (err) {
    console.error("GET /api/auth/me error:", err.message);
    return res.status(500).json({ message: "Failed to load profile" });
  }
});

module.exports = router;
