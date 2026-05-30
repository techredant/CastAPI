const User = require("../src/models/user");
const Post = require("../src/models/post");
const VerificationRequest = require("../src/models/verificationRequest");
const {
  VERIFICATION_PLANS,
  resolvePlanPricing,
  plansForApi,
} = require("../src/config/verificationPricing");
const { sendPushNotification } = require("./pushNotification.service");

const ACTIVE_STATUSES = ["pending_payment", "pending_review", "approved"];

async function syncUserVerifiedOnPosts(clerkId, isVerified, verificationType) {
  await Post.updateMany(
    { userId: clerkId },
    {
      $set: {
        "user.isVerified": !!isVerified,
        "user.verificationType": isVerified ? verificationType || "" : "",
      },
    },
  );
}

async function markVerificationPaid(request) {
  if (!request || request.status !== "pending_payment") return request;
  request.status = "pending_review";
  request.paidAt = new Date();
  await request.save();
  return request;
}

async function applyVerificationToUser(user, request) {
  const pricing = resolvePlanPricing(
    request.verificationType,
    request.billingCycle || "yearly",
  );
  const durationDays = pricing?.durationDays || 365;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);

  user.isVerified = true;
  user.verificationType = request.verificationType;
  user.verifiedAt = new Date();
  user.verificationExpiresAt = expiresAt;
  user.activeVerificationRequestId = request._id;
  await user.save();

  request.status = "approved";
  request.reviewedAt = new Date();
  request.expiresAt = expiresAt;
  await request.save();

  await syncUserVerifiedOnPosts(
    user.clerkId,
    true,
    request.verificationType,
  );

  return user;
}

async function revokeUserVerification(user, request, reason = "") {
  user.isVerified = false;
  user.verificationType = null;
  user.verifiedAt = null;
  user.verificationExpiresAt = null;
  user.activeVerificationRequestId = null;
  await user.save();

  if (request) {
    request.status = "revoked";
    request.rejectionReason = reason || request.rejectionReason;
    request.reviewedAt = new Date();
    await request.save();
  }

  await syncUserVerifiedOnPosts(user.clerkId, false, "");
}

async function expireVerificationIfNeeded(user) {
  if (!user?.isVerified || !user.verificationExpiresAt) return user;

  if (new Date() > new Date(user.verificationExpiresAt)) {
    const req = user.activeVerificationRequestId
      ? await VerificationRequest.findById(user.activeVerificationRequestId)
      : null;

    if (req && req.status === "approved") {
      req.status = "expired";
      await req.save();
    }

    await revokeUserVerification(user, null, "Subscription expired");
  }

  return user;
}

async function notifyAdminsNewRequest(io, request, user) {
  if (!io) return;

  const admins = await User.find({
    role: "admin",
    expoPushToken: { $exists: true, $ne: null },
  }).limit(50);

  const title = "New verification request";
  const body = `${user?.nickName || user?.firstName || "User"} applied for ${request.verificationType} verification`;

  for (const admin of admins) {
    io.to(admin.clerkId).emit("newNotification", {
      type: "verification",
      requestId: request._id.toString(),
      title,
      body,
    });

    if (admin.expoPushToken) {
      await sendPushNotification(admin.expoPushToken, title, body, {
        screen: "verification",
        requestId: request._id.toString(),
      });
    }
  }
}

module.exports = {
  VERIFICATION_PLANS,
  resolvePlanPricing,
  plansForApi,
  ACTIVE_STATUSES,
  syncUserVerifiedOnPosts,
  markVerificationPaid,
  applyVerificationToUser,
  revokeUserVerification,
  expireVerificationIfNeeded,
  notifyAdminsNewRequest,
};
