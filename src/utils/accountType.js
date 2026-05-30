const PERSONAL_ACCOUNT = "Personal Account";

function isNonPersonalAccount(accountType) {
  return Boolean(accountType && accountType !== PERSONAL_ACCOUNT);
}

function getPostAuthorClerkId(post) {
  return post?.userId || post?.user?.clerkId || "";
}

function getPostAuthorAccountType(post) {
  return post?.user?.accountType || post?.accountType || "";
}

function isNewsFeedPost(post, followingIds) {
  const authorId = getPostAuthorClerkId(post);
  const accountType = getPostAuthorAccountType(post);
  if (!authorId || !isNonPersonalAccount(accountType)) return false;
  if (!followingIds || followingIds.size === 0) return false;
  return followingIds.has(authorId);
}

module.exports = {
  PERSONAL_ACCOUNT,
  isNonPersonalAccount,
  getPostAuthorClerkId,
  getPostAuthorAccountType,
  isNewsFeedPost,
};
