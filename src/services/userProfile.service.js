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

async function applyPendingProfileUpdates(user) {
  if (!user?.profileUpdateAt) return user;

  if (new Date() >= new Date(user.profileUpdateAt)) {
    if (user.pendingFirstName) user.firstName = user.pendingFirstName;
    if (user.pendingLastName) user.lastName = user.pendingLastName;
    if (user.pendingNickName) user.nickName = user.pendingNickName;
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

    await user.save();
  }

  return user;
}

function userToAuthDto(user) {
  const isPersonal = isPersonalAccountType(user.accountType);
  const hasName = isPersonal
    ? Boolean(user.firstName?.trim() && user.lastName?.trim())
    : Boolean(user.companyName?.trim());
  const hasNick = Boolean(user.nickName?.trim());
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
  userToAuthDto,
};
