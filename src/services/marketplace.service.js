const Product = require("../models/product");
const ProductBoost = require("../models/productBoost");
const SellerSubscription = require("../models/sellerSubscription");
const ProductReview = require("../models/productReview");
const User = require("../models/user");
const { BOOST_PLANS, SELLER_SUBSCRIPTION, FREE_LISTING_LIMIT } = require("../config/marketPricing");
const {
  initiateStkPush,
  queryStkPush,
  classifyStkQueryResult,
  shouldSandboxAutoComplete,
} = require("../../services/mpesa.service");
const { detectFraudWarnings } = require("./productRanking.service");

async function countActiveListings(userId) {
  return Product.countDocuments({ userId, status: "active" });
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

async function getActiveSellerSubscription(userId) {
  await expireStaleSubscriptions();
  return SellerSubscription.findOne({
    userId,
    status: "active",
    expiresAt: { $gt: new Date() },
  }).sort({ expiresAt: -1 });
}

async function canCreateFreeListing(userId) {
  const premium = await getActiveSellerSubscription(userId);
  const limit = premium ? SELLER_SUBSCRIPTION.maxFreeListings || 50 : FREE_LISTING_LIMIT;
  const count = await countActiveListings(userId);
  return { allowed: count < limit, count, limit, isPremium: !!premium };
}

async function activateBoost(productId, userId, planId, checkoutIds = {}) {
  const plan = BOOST_PLANS[planId];
  if (!plan) throw new Error("Invalid boost plan");

  const product = await Product.findOne({ _id: productId, userId });
  if (!product) throw new Error("Product not found");

  const boost = await ProductBoost.create({
    productId,
    userId,
    planId,
    amount: plan.amount,
    rankWeight: plan.rankWeight,
    status: "pending_payment",
    ...checkoutIds,
  });

  return finalizeBoostPayment(boost, product);
}

/** Activate a pending boost after M-Pesa confirms (or mock). */
async function finalizeBoostPayment(boostDoc, productDoc) {
  if (!boostDoc || boostDoc.status !== "pending_payment") {
    throw new Error("Boost payment is not pending");
  }

  const plan = BOOST_PLANS[boostDoc.planId];
  if (!plan) throw new Error("Invalid boost plan");

  const product =
    productDoc ||
    (await Product.findOne({ _id: boostDoc.productId, userId: boostDoc.userId }));
  if (!product) throw new Error("Product not found");

  const startsAt = new Date();
  const base =
    product.boostExpiresAt && new Date(product.boostExpiresAt) > startsAt
      ? new Date(product.boostExpiresAt)
      : startsAt;
  const expiresAt = new Date(base);
  expiresAt.setDate(expiresAt.getDate() + plan.durationDays);

  boostDoc.status = "active";
  boostDoc.startsAt = startsAt;
  boostDoc.expiresAt = expiresAt;
  await boostDoc.save();

  product.listingType = "boosted";
  product.isPromoted = true;
  product.boostExpiresAt = expiresAt;
  product.boostRankWeight = plan.rankWeight;
  await product.save();

  return { boost: boostDoc, product, expiresAt };
}

async function finalizeSubscriptionPayment(subDoc) {
  if (!subDoc || subDoc.status !== "pending_payment") {
    throw new Error("Subscription payment is not pending");
  }

  const startsAt = new Date();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SELLER_SUBSCRIPTION.durationDays);

  await SellerSubscription.updateMany(
    { userId: subDoc.userId, status: "active", _id: { $ne: subDoc._id } },
    { $set: { status: "expired" } },
  );

  subDoc.status = "active";
  subDoc.startsAt = startsAt;
  subDoc.expiresAt = expiresAt;
  await subDoc.save();
  await User.findOneAndUpdate(
    { clerkId: subDoc.userId },
    { isPremiumSeller: true },
  );

  return subDoc;
}

async function activatePremiumSubscription(userId, checkoutIds = {}) {
  const startsAt = new Date();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SELLER_SUBSCRIPTION.durationDays);

  await SellerSubscription.updateMany(
    { userId, status: "active" },
    { $set: { status: "expired" } },
  );

  const sub = await SellerSubscription.create({
    userId,
    planId: SELLER_SUBSCRIPTION.id,
    amount: SELLER_SUBSCRIPTION.amount,
    status: "active",
    startsAt,
    expiresAt,
    ...checkoutIds,
  });

  await User.findOneAndUpdate({ clerkId: userId }, { isPremiumSeller: true });

  return sub;
}

async function getSellerAnalytics(userId) {
  await expireStaleSubscriptions();
  const products = await Product.find({ userId });
  const active = products.filter((p) => p.status === "active");
  const now = new Date();
  const boosted = active.filter(
    (p) =>
      p.isPromoted &&
      p.boostExpiresAt &&
      new Date(p.boostExpiresAt) > now,
  );

  const reviews = await ProductReview.find({ sellerId: userId });
  const avgRating =
    reviews.length > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : 0;

  const premium = await getActiveSellerSubscription(userId);

  const listingCheck = await canCreateFreeListing(userId);
  const productAnalytics = products
    .map((product) => {
      const isBoostActive =
        product.isPromoted &&
        product.boostExpiresAt &&
        new Date(product.boostExpiresAt) > now;
      return {
        _id: product._id,
        title: product.title,
        media: product.media?.slice?.(0, 1) || [],
        price: product.price,
        status: product.status,
        views: product.viewCount || 0,
        saves: product.favoriteCount || 0,
        chats: product.chatCount || 0,
        isPromoted: !!isBoostActive,
        boostExpiresAt: isBoostActive ? product.boostExpiresAt : null,
        boostRankWeight: isBoostActive ? product.boostRankWeight || 0 : 0,
        listingHealth:
          product.status === "flagged"
            ? "Needs review"
            : isBoostActive
              ? "Boosted"
              : "Active",
        createdAt: product.createdAt,
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    totalListings: products.length,
    activeListings: active.length,
    soldListings: products.filter((p) => p.status === "sold").length,
    boostedListings: boosted.length,
    totalViews: products.reduce((s, p) => s + (p.viewCount || 0), 0),
    totalFavorites: products.reduce((s, p) => s + (p.favoriteCount || 0), 0),
    totalChats: products.reduce((s, p) => s + (p.chatCount || 0), 0),
    averageRating: Math.round(avgRating * 10) / 10,
    reviewCount: reviews.length,
    isPremiumSeller: !!premium,
    premiumExpiresAt: premium?.expiresAt || null,
    premiumStatus: premium
      ? {
          planId: premium.planId,
          status: premium.status,
          expiresAt: premium.expiresAt,
          daysRemaining: Math.max(
            0,
            Math.ceil(
              (new Date(premium.expiresAt).getTime() - now.getTime()) /
                86400000,
            ),
          ),
        }
      : null,
    listingQuota: listingCheck,
    products: productAnalytics,
  };
}

async function updateSellerRating(sellerId) {
  const reviews = await ProductReview.find({ sellerId });
  const ratingCount = reviews.length;
  const ratingAvg =
    ratingCount > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / ratingCount
      : 0;

  await User.findOneAndUpdate(
    { clerkId: sellerId },
    { ratingAvg: Math.round(ratingAvg * 10) / 10, ratingCount },
  );
}

async function initiateBoostPayment({ productId, userId, planId, phoneNumber }) {
  const plan = BOOST_PLANS[planId];
  if (!plan) throw new Error("Invalid boost plan");

  const product = await Product.findOne({ _id: productId, userId });
  if (!product) {
    throw new Error("Only the listing owner can boost this product");
  }

  const boost = await ProductBoost.create({
    productId,
    userId,
    planId,
    amount: plan.amount,
    rankWeight: plan.rankWeight,
    status: "pending_payment",
  });

  let stk;
  try {
    stk = await initiateStkPush({
      phoneNumber,
      amount: plan.amount,
      accountReference: `BST${String(boost._id).slice(-8)}`,
      description: plan.label,
    });
  } catch (stkErr) {
    boost.status = "cancelled";
    await boost.save();
    throw stkErr;
  }

  boost.mpesaCheckoutRequestId = stk.CheckoutRequestID;
  boost.mpesaMerchantRequestId = stk.MerchantRequestID;
  await boost.save();

  if (stk.mock) {
    const activated = await finalizeBoostPayment(boost, product);
    return {
      boost: activated.boost,
      product: activated.product,
      expiresAt: activated.expiresAt,
      checkoutRequestId: stk.CheckoutRequestID,
      mock: true,
    };
  }

  return {
    boost,
    checkoutRequestId: stk.CheckoutRequestID,
    mock: false,
  };
}

async function initiateSubscriptionPayment({ userId, phoneNumber }) {
  const sub = await SellerSubscription.create({
    userId,
    planId: SELLER_SUBSCRIPTION.id,
    amount: SELLER_SUBSCRIPTION.amount,
    status: "pending_payment",
  });

  let stk;
  try {
    stk = await initiateStkPush({
      phoneNumber,
      amount: SELLER_SUBSCRIPTION.amount,
      accountReference: `SEL${String(sub._id).slice(-8)}`,
      description: SELLER_SUBSCRIPTION.label,
    });
  } catch (stkErr) {
    sub.status = "cancelled";
    await sub.save();
    throw stkErr;
  }

  sub.mpesaCheckoutRequestId = stk.CheckoutRequestID;
  sub.mpesaMerchantRequestId = stk.MerchantRequestID;
  await sub.save();

  if (stk.mock) {
    const activated = await finalizeSubscriptionPayment(sub);
    return {
      subscription: activated,
      checkoutRequestId: stk.CheckoutRequestID,
      mock: true,
    };
  }

  return {
    subscription: sub,
    checkoutRequestId: stk.CheckoutRequestID,
    mock: false,
  };
}

async function syncBoostPaymentStatus(checkoutRequestId) {
  const boost = await ProductBoost.findOne({
    mpesaCheckoutRequestId: checkoutRequestId,
  });
  if (!boost) return null;

  if (
    boost.status === "pending_payment" &&
    boost.mpesaCheckoutRequestId &&
    process.env.MPESA_MOCK !== "true"
  ) {
    try {
      const q = await queryStkPush(boost.mpesaCheckoutRequestId);
      const stkStatus = classifyStkQueryResult(q);
      if (stkStatus === "completed") {
        await finalizeBoostPayment(boost);
      } else if (stkStatus === "failed") {
        if (!shouldSandboxAutoComplete(boost)) {
          boost.status = "cancelled";
          await boost.save();
        }
      }
    } catch (pollErr) {
      console.error("boost stk query:", pollErr.message);
    }

    if (boost.status === "pending_payment" && shouldSandboxAutoComplete(boost)) {
      await finalizeBoostPayment(boost);
    }
  }

  return boost;
}

async function syncSubscriptionPaymentStatus(checkoutRequestId) {
  const sub = await SellerSubscription.findOne({
    mpesaCheckoutRequestId: checkoutRequestId,
  });
  if (!sub) return null;

  if (
    sub.status === "pending_payment" &&
    sub.mpesaCheckoutRequestId &&
    process.env.MPESA_MOCK !== "true"
  ) {
    try {
      const q = await queryStkPush(sub.mpesaCheckoutRequestId);
      const stkStatus = classifyStkQueryResult(q);
      if (stkStatus === "completed") {
        await finalizeSubscriptionPayment(sub);
        await User.findOneAndUpdate(
          { clerkId: sub.userId },
          { isPremiumSeller: true },
        );
      } else if (stkStatus === "failed") {
        if (!shouldSandboxAutoComplete(sub)) {
          sub.status = "cancelled";
          await sub.save();
        }
      }
    } catch (pollErr) {
      console.error("subscription stk query:", pollErr.message);
    }

    if (sub.status === "pending_payment" && shouldSandboxAutoComplete(sub)) {
      await finalizeSubscriptionPayment(sub);
      await User.findOneAndUpdate(
        { clerkId: sub.userId },
        { isPremiumSeller: true },
      );
    }
  }

  return sub;
}

function applyFraudCheckToProduct(product, body) {
  const fraud = detectFraudWarnings({
    title: body.title ?? product.title,
    price: body.price ?? product.price,
    description: body.description ?? product.description,
    phoneNumber: body.phoneNumber ?? product.phoneNumber,
  });
  product.fraudFlags = fraud;
  if (fraud.score >= 40) {
    product.status = "flagged";
  }
  return product;
}

module.exports = {
  BOOST_PLANS,
  SELLER_SUBSCRIPTION,
  expireStaleSubscriptions,
  getActiveSellerSubscription,
  countActiveListings,
  canCreateFreeListing,
  activateBoost,
  activatePremiumSubscription,
  finalizeBoostPayment,
  finalizeSubscriptionPayment,
  syncBoostPaymentStatus,
  syncSubscriptionPaymentStatus,
  getSellerAnalytics,
  updateSellerRating,
  initiateBoostPayment,
  initiateSubscriptionPayment,
  applyFraudCheckToProduct,
};
