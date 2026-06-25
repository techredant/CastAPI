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
  const byRegex = await User.findOne({
    email: { $regex: new RegExp(`^${escaped}$`, "i") },
  });
  if (byRegex) return byRegex;

  return User.findOne(
    { email: normalized },
    null,
    { collation: { locale: "en", strength: 2 } },
  );
}

async function linkGoogleProfile(user, googleProfile) {
  const email = normalizeEmail(googleProfile.email);
  if (normalizeEmail(user.email) !== email) {
    user.email = email;
  }
  if (googleProfile.picture && !user.image) {
    user.image = googleProfile.picture;
  }
  if (googleProfile.given_name && !user.firstName?.trim()) {
    user.firstName = googleProfile.given_name;
  }
  if (googleProfile.family_name && !user.lastName?.trim()) {
    user.lastName = googleProfile.family_name;
  }
  user.provider = "google";
  await user.save();
  return user;
}

async function findExistingGoogleUser(googleProfile) {
  const email = normalizeEmail(googleProfile.email);
  const googleClerkId = `google_${googleProfile.sub}`;

  const byClerk = await User.findOne({ clerkId: googleClerkId });
  if (byClerk) return byClerk;

  return findUserByEmail(email);
}

async function findOrCreateUserFromGoogle(googleProfile) {
  const email = normalizeEmail(googleProfile.email);
  const googleClerkId = `google_${googleProfile.sub}`;

  const existing = await findExistingGoogleUser(googleProfile);
  if (existing) {
    const user = await linkGoogleProfile(existing, googleProfile);
    return { user, isNewUser: false };
  }

  const fromName = splitName(googleProfile.name);
  const firstName = googleProfile.given_name || fromName.firstName;
  const lastName = googleProfile.family_name || fromName.lastName;

  const payload = {
    clerkId: googleClerkId,
    email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    image: googleProfile.picture || undefined,
    provider: "google",
    accountType: "Personal Account",
  };

  try {
    const user = await User.create(payload);
    return { user, isNewUser: true };
  } catch (err) {
    if (err?.code !== 11000) throw err;

    const recovered = await findExistingGoogleUser(googleProfile);
    if (recovered) {
      const user = await linkGoogleProfile(recovered, googleProfile);
      return { user, isNewUser: false };
    }

    if (err.keyPattern?.nickName) {
      const user = await User.create({
        ...payload,
        nickName: `pending_${googleProfile.sub}`,
      });
      return { user, isNewUser: true };
    }

    throw err;
  }
}

router.post("/google", async (req, res) => {
  try {
    const { idToken } = req.body || {};
    const googleProfile = await verifyGoogleIdToken(idToken);
    const { user, isNewUser } = await findOrCreateUserFromGoogle(googleProfile);

    try {
      await applyPendingProfileUpdates(user);
    } catch (pendingErr) {
      console.warn(
        "applyPendingProfileUpdates on login:",
        pendingErr?.message || pendingErr,
      );
    }

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
          "This Google account is already linked to another profile. Sign in with the email you used when you first joined, or contact support.",
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
