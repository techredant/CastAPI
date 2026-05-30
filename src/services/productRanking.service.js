const Product = require("../models/product");
const ProductBoost = require("../models/productBoost");
const SellerSubscription = require("../models/sellerSubscription");
const User = require("../models/user");
const { SELLER_SUBSCRIPTION } = require("../config/marketPricing");

/** Expire boosts and clear product promotion flags */
async function expireStaleBoosts() {
  const now = new Date();

  await ProductBoost.updateMany(
    { status: "active", expiresAt: { $lte: now } },
    { $set: { status: "expired" } },
  );

  await Product.updateMany(
    {
      listingType: "boosted",
      boostExpiresAt: { $lte: now },
    },
    {
      $set: {
        listingType: "free",
        isPromoted: false,
        boostRankWeight: 0,
        boostExpiresAt: null,
      },
    },
  );
}

async function expireStaleSubscriptions() {
  const now = new Date();
  const expired = await SellerSubscription.find({
    status: "active",
    expiresAt: { $lte: now },
  }).select("userId");
  if (!expired.length) return;

  const userIds = [...new Set(expired.map((sub) => sub.userId))];
  await SellerSubscription.updateMany(
    { _id: { $in: expired.map((sub) => sub._id) } },
    { $set: { status: "expired" } },
  );
  await User.updateMany(
    { clerkId: { $in: userIds } },
    { $set: { isPremiumSeller: false } },
  );
}

/** Compute sort score for marketplace ranking */
function computeRankScore(product, seller = null, isPremiumSeller = false) {
  const now = Date.now();
  const ageHours =
    (now - new Date(product.createdAt).getTime()) / (1000 * 60 * 60);
  const recencyScore = Math.max(0, 100 - ageHours * 0.5);

  let boostScore = 0;
  if (
    product.isPromoted &&
    product.boostExpiresAt &&
    new Date(product.boostExpiresAt) > new Date()
  ) {
    boostScore = product.boostRankWeight || 50;
  }

  const engagementScore =
    (product.viewCount || 0) * 0.1 +
    (product.favoriteCount || 0) * 2 +
    (product.chatCount || 0) * 3;

  const verifiedBonus = seller?.isVerified ? 15 : 0;
  const premiumBonus = isPremiumSeller
    ? SELLER_SUBSCRIPTION.listingBoostWeight || 25
    : 0;
  const fraudPenalty = Math.min(60, product.fraudFlags?.score || 0);

  return (
    recencyScore +
    boostScore +
    engagementScore +
    verifiedBonus +
    premiumBonus -
    fraudPenalty
  );
}

async function getPremiumSellerIds(userIds) {
  const now = new Date();
  const subs = await SellerSubscription.find({
    userId: { $in: userIds },
    status: "active",
    expiresAt: { $gt: now },
  }).select("userId");
  return new Set(subs.map((s) => s.userId));
}

/** Attach seller summary + rankScore to product list */
async function enrichProducts(products) {
  await Promise.all([expireStaleBoosts(), expireStaleSubscriptions()]);

  const sellerIds = [...new Set(products.map((p) => p.userId))];
  const [users, premiumSet] = await Promise.all([
    User.find({ clerkId: { $in: sellerIds } }).select(
      "clerkId firstName lastName nickName image isVerified verificationType county ratingAvg ratingCount",
    ),
    getPremiumSellerIds(sellerIds),
  ]);

  const userMap = Object.fromEntries(users.map((u) => [u.clerkId, u]));

  return products.map((p) => {
    const doc = p.toObject ? p.toObject() : { ...p };
    const seller = userMap[doc.userId];
    const isPremiumSeller = premiumSet.has(doc.userId);
    return {
      ...doc,
      rankScore: computeRankScore(doc, seller, isPremiumSeller),
      boostStatus:
        doc.isPromoted && doc.boostExpiresAt && new Date(doc.boostExpiresAt) > new Date()
          ? "active"
          : "inactive",
      boostExpiresAt: doc.isPromoted ? doc.boostExpiresAt : null,
      trustScore: Math.max(
        0,
        100 +
          (seller?.isVerified ? 10 : 0) +
          (isPremiumSeller ? 5 : 0) -
          (doc.fraudFlags?.score || 0),
      ),
      seller: seller
        ? {
            clerkId: seller.clerkId,
            name:
              seller.nickName ||
              [seller.firstName, seller.lastName].filter(Boolean).join(" ") ||
              "Seller",
            image: seller.image,
            isVerified: !!seller.isVerified,
            isPremiumSeller,
            county: seller.county,
            ratingAvg: seller.ratingAvg || 0,
            ratingCount: seller.ratingCount || 0,
          }
        : null,
    };
  });
}

function sortByRank(products, sort = "relevance") {
  const list = [...products];
  switch (sort) {
    case "text_relevance":
      return list.sort(
        (a, b) =>
          (b.score || 0) - (a.score || 0) ||
          (b.rankScore || 0) - (a.rankScore || 0),
      );
    case "newest":
      return list.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      );
    case "price_asc":
      return list.sort((a, b) => a.price - b.price);
    case "price_desc":
      return list.sort((a, b) => b.price - a.price);
    case "popular":
      return list.sort(
        (a, b) =>
          (b.viewCount || 0) +
          (b.favoriteCount || 0) * 2 -
          ((a.viewCount || 0) + (a.favoriteCount || 0) * 2),
      );
    case "relevance":
    default:
      return list.sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));
  }
}

/** Simple fraud heuristics for new/updated listings */
function detectFraudWarnings({ title, price, description, phoneNumber }) {
  const warnings = [];
  let score = 0;

  if (price <= 0) {
    warnings.push("Suspicious price");
    score += 30;
  }
  if (price > 0 && price < 100) {
    warnings.push("Unusually low price");
    score += 15;
  }
  const linkCount = (description || "").match(/https?:\/\//gi)?.length || 0;
  if (linkCount > 2) {
    warnings.push("Multiple external links");
    score += 20;
  }
  if ((title || "").length < 4) {
    warnings.push("Very short title");
    score += 10;
  }
  const repeatedDigits = String(phoneNumber).match(/(\d)\1{5,}/);
  if (repeatedDigits) {
    warnings.push("Suspicious phone number");
    score += 15;
  }

  return { score, warnings };
}

module.exports = {
  expireStaleBoosts,
  computeRankScore,
  enrichProducts,
  sortByRank,
  detectFraudWarnings,
  getPremiumSellerIds,
};
