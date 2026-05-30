/** Marketplace monetization (KES) */
const BOOST_PLANS = {
  basic: {
    id: "basic",
    label: "Boost 3 days",
    durationDays: 3,
    amount: 99,
    rankWeight: 50,
  },
  standard: {
    id: "standard",
    label: "Boost 7 days",
    durationDays: 7,
    amount: 199,
    rankWeight: 100,
  },
  premium: {
    id: "premium",
    label: "Boost 14 days",
    durationDays: 14,
    amount: 349,
    rankWeight: 200,
  },
};

const SELLER_SUBSCRIPTION = {
  id: "premium_seller",
  label: "Premium Seller",
  description: "Priority listings, analytics dashboard, verified badge highlight",
  amount: 499,
  currency: "KES",
  durationDays: 30,
  listingBoostWeight: 25,
  maxFreeListings: 50,
};

const FREE_LISTING_LIMIT = 10;

module.exports = {
  BOOST_PLANS,
  SELLER_SUBSCRIPTION,
  FREE_LISTING_LIMIT,
};
