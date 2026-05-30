/** Sponsored ads pricing — amounts in KES */
const AD_CTA_TYPES = [
  "shop_now",
  "learn_more",
  "download",
  "contact_us",
  "visit_website",
  "install_app",
];

const AD_INTERESTS = [
  "cars",
  "fashion",
  "electronics",
  "food",
  "real_estate",
  "jobs",
  "gaming",
  "business",
  "technology",
];

const AD_MARKETPLACE_BEHAVIORS = ["buyers", "sellers", "frequent_shoppers"];

const AD_MEDIA_TYPES = ["image", "video", "carousel", "product"];

const CAMPAIGN_STATUSES = [
  "pending_review",
  "active",
  "paused",
  "rejected",
  "completed",
];

const MODERATION_REASONS = [
  "scam",
  "adult_content",
  "misleading",
  "spam",
  "illegal_products",
];

/** Cost per 1000 impressions (CPM) tiers */
const BUDGET_PLANS = {
  starter: {
    id: "starter",
    name: "Starter",
    minBudget: 500,
    cpm: 120,
    maxDurationDays: 7,
    description: "Local reach — great for small businesses",
  },
  growth: {
    id: "growth",
    name: "Growth",
    minBudget: 2000,
    cpm: 95,
    maxDurationDays: 14,
    description: "County-wide promotion",
  },
  premium: {
    id: "premium",
    name: "Premium",
    minBudget: 10000,
    cpm: 75,
    maxDurationDays: 30,
    description: "National campaigns for brands",
  },
};

/** Default feed insertion: one ad every N organic posts */
const FEED_AD_INTERVAL = 6;

/** Max impressions per user per ad per 24h */
const FREQUENCY_CAP_PER_AD = 3;

/** Max ads per feed page fetch */
const MAX_ADS_PER_REQUEST = 3;

module.exports = {
  AD_CTA_TYPES,
  AD_INTERESTS,
  AD_MARKETPLACE_BEHAVIORS,
  AD_MEDIA_TYPES,
  CAMPAIGN_STATUSES,
  MODERATION_REASONS,
  BUDGET_PLANS,
  FEED_AD_INTERVAL,
  FREQUENCY_CAP_PER_AD,
  MAX_ADS_PER_REQUEST,
};
