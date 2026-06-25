const Post = require("../models/post");
const Comment = require("../models/comment");

const normalizeProfileStr = (value) =>
  typeof value === "string" ? value.trim() : "";

function isPersonalAccountType(accountType) {
  const t = (accountType || "").trim();
  if (!t || t === "Personal Account" || t.toLowerCase() === "personal") {
    return true;
  }
  return !/organization|business|non-profit|public figure|media|e-commerce|entertainment/i.test(
    t,
  );
}

/** Push live profile fields onto every post authored or recited by this user. */
async function syncUserProfileOnPosts(user) {
  if (!user?.clerkId) return;

  const embed = {
    "user.clerkId": user.clerkId,
    "user.firstName": user.firstName || "",
    "user.lastName": user.lastName || "",
    "user.nickName": user.nickName || "",
    "user.companyName": user.companyName || "",
    "user.image": user.image || "",
    "user.accountType": user.accountType || "",
    "user.isVerified": !!user.isVerified,
    "user.verificationType": user.isVerified ? user.verificationType || "" : "",
  };

  await Post.updateMany({ userId: user.clerkId }, { $set: embed });

  await Post.updateMany(
    { reciteUserId: user.clerkId },
    {
      $set: {
        reciteFirstName: user.firstName || "",
        reciteLastName: user.lastName || "",
        reciteNickName: user.nickName || "",
        reciteCompanyName: user.companyName || "",
        reciteImage: user.image || "",
      },
    },
  );

  const commentUser = {
    "user.clerkId": user.clerkId,
    "user.firstName": user.firstName || "",
    "user.lastName": user.lastName || "",
    "user.nickName": user.nickName || "",
    "user.companyName": user.companyName || "",
    "user.image": user.image || "",
  };
  await Comment.updateMany({ userId: user.clerkId }, { $set: commentUser });

  const replyUser = {
    "replies.$[reply].user.clerkId": user.clerkId,
    "replies.$[reply].user.firstName": user.firstName || "",
    "replies.$[reply].user.lastName": user.lastName || "",
    "replies.$[reply].user.nickName": user.nickName || "",
    "replies.$[reply].user.companyName": user.companyName || "",
    "replies.$[reply].user.image": user.image || "",
  };
  await Comment.updateMany(
    { "replies.userId": user.clerkId },
    { $set: replyUser },
    { arrayFilters: [{ "reply.userId": user.clerkId }] },
  );
}

async function applyPendingProfileUpdates(user) {
  if (!user?.profileUpdateAt) return user;

  if (new Date() >= new Date(user.profileUpdateAt)) {
    const appliedPendingNick = user.pendingNickName;
    if (user.pendingFirstName) user.firstName = user.pendingFirstName;
    if (user.pendingLastName) user.lastName = user.pendingLastName;
    if (appliedPendingNick) user.nickName = appliedPendingNick;
    if (user.pendingCompanyName) user.companyName = user.pendingCompanyName;
    if (user.pendingCounty) user.county = user.pendingCounty;
    if (user.pendingConstituency) user.constituency = user.pendingConstituency;
    if (user.pendingWard) user.ward = user.pendingWard;

    user.pendingFirstName = undefined;
    user.pendingLastName = undefined;
    user.pendingNickName = undefined;
    user.pendingImage = undefined;
    user.pendingCompanyName = undefined;
    user.pendingCounty = undefined;
    user.pendingConstituency = undefined;
    user.pendingWard = undefined;

    user.profileUpdateAt = null;

    try {
      await user.save();
      await syncUserProfileOnPosts(user);
    } catch (err) {
      if (err?.code === 11000 && err.keyPattern?.nickName) {
        if (appliedPendingNick && user.nickName === appliedPendingNick) {
          user.nickName = undefined;
        }
        await user.save();
      } else {
        throw err;
      }
    }
  }

  return user;
}

function isUsableNickName(nick) {
  const value = (nick || "").trim();
  return value.length > 0 && !value.startsWith("pending_");
}

function userToAuthDto(user) {
  const isPersonal = isPersonalAccountType(user.accountType);
  const hasName = isPersonal
    ? Boolean(user.firstName?.trim() && user.lastName?.trim())
    : Boolean(user.companyName?.trim());
  const hasNick = isUsableNickName(user.nickName);
  const hasLocation = Boolean(
    user.county?.trim() && user.constituency?.trim() && user.ward?.trim(),
  );
  // New users need nickname + name. Legacy / returning users with location
  // already set are treated as past the name step (Clerk migration).
  const hasCompletedName = hasName && (hasNick || hasLocation);
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

module.exports = {
  normalizeProfileStr,
  isPersonalAccountType,
  applyPendingProfileUpdates,
  syncUserProfileOnPosts,
  userToAuthDto,
};
