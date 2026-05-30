const SponsoredAd = require("../models/sponsoredAd");
const AdCampaign = require("../models/adCampaign");
const AdImpression = require("../models/adImpression");
const Advertiser = require("../models/advertiser");
const User = require("../models/user");
const Product = require("../models/product");
const {
  FREQUENCY_CAP_PER_AD,
  MAX_ADS_PER_REQUEST,
} = require("../config/adPricing");

function matchesTargeting(user, targeting = {}) {
  if (!targeting || Object.keys(targeting).length === 0) return true;

  if (targeting.counties?.length && user?.county) {
    if (!targeting.counties.some((c) => c.toLowerCase() === user.county.toLowerCase())) {
      return false;
    }
  }

  if (targeting.cities?.length && user?.ward) {
    const cityMatch = targeting.cities.some(
      (c) =>
        c.toLowerCase() === (user.ward || "").toLowerCase() ||
        c.toLowerCase() === (user.constituency || "").toLowerCase(),
    );
    if (!cityMatch) return false;
  }

  if (targeting.countries?.length) {
    const kenya = targeting.countries.some((c) =>
      ["kenya", "ke"].includes(c.toLowerCase()),
    );
    if (!kenya && targeting.countries.length > 0) return false;
  }

  return true;
}

async function getRecentImpressionCounts(viewerClerkId, adIds) {
  if (!viewerClerkId || !adIds.length) return {};

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await AdImpression.aggregate([
    {
      $match: {
        viewerClerkId,
        adId: { $in: adIds },
        createdAt: { $gte: since },
      },
    },
    { $group: { _id: "$adId", count: { $sum: 1 } } },
  ]);

  return rows.reduce((acc, r) => {
    acc[String(r._id)] = r.count;
    return acc;
  }, {});
}

function scoreAd(ad, impressionCount, excludeIds) {
  if (excludeIds.has(String(ad._id))) return -1;
  if (impressionCount >= FREQUENCY_CAP_PER_AD) return -1;

  let score = 50 + Math.random() * 30;
  if (ad.isVerified) score += 15;
  score -= impressionCount * 12;
  return score;
}

/**
 * Select sponsored ads for feed injection.
 */
async function deliverAds({
  viewerClerkId,
  levelType,
  levelValue,
  limit = MAX_ADS_PER_REQUEST,
  excludeAdIds = [],
}) {
  const now = new Date();

  const advertiserBanned = await Advertiser.find({
    isBanned: true,
  }).select("_id");
  const bannedIds = advertiserBanned.map((a) => a._id);

  const campaigns = await AdCampaign.find({
    status: "active",
    paymentStatus: "paid",
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    $expr: { $lt: ["$budgetSpent", "$budgetTotal"] },
    advertiserId: { $nin: bannedIds },
  })
    .limit(50)
    .lean();

  if (!campaigns.length) return [];

  const campaignIds = campaigns.map((c) => c._id);
  const campaignMap = Object.fromEntries(
    campaigns.map((c) => [String(c._id), c]),
  );

  let user = null;
  if (viewerClerkId) {
    user = await User.findOne({ clerkId: viewerClerkId }).lean();
  }

  const eligibleCampaignIds = campaigns
    .filter((c) => matchesTargeting(user, c.targeting))
    .map((c) => c._id);

  if (!eligibleCampaignIds.length) return [];

  const ads = await SponsoredAd.find({
    campaignId: { $in: eligibleCampaignIds },
    isActive: true,
    _id: { $nin: excludeAdIds },
    ...(viewerClerkId
      ? { hiddenByUsers: { $ne: viewerClerkId } }
      : {}),
  }).lean();

  if (!ads.length) return [];

  const adIds = ads.map((a) => a._id);
  const impressionCounts = await getRecentImpressionCounts(
    viewerClerkId,
    adIds,
  );
  const excludeSet = new Set(excludeAdIds.map(String));

  const ranked = ads
    .map((ad) => ({
      ad,
      score: scoreAd(
        ad,
        impressionCounts[String(ad._id)] || 0,
        excludeSet,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map(({ ad }) => {
    const campaign = campaignMap[String(ad.campaignId)];
    return {
      ...ad,
      feedItemType: "sponsored_ad",
      _feedKey: `ad-${ad._id}`,
      campaignStatus: campaign?.status,
    };
  });
}

async function getAdForDetail(adId, viewerClerkId) {
  const ad = await SponsoredAd.findById(adId).lean();
  if (!ad || !ad.isActive) return null;

  const campaign = await AdCampaign.findById(ad.campaignId).lean();
  if (!campaign || campaign.status !== "active") return null;

  let relatedProducts = [];
  if (ad.productId) {
    const product = await Product.findById(ad.productId).lean();
    if (product) {
      relatedProducts = await Product.find({
        userId: product.userId,
        status: "active",
        _id: { $ne: product._id },
      })
        .limit(6)
        .lean();
      relatedProducts = [product, ...relatedProducts];
    }
  }

  return {
    ...ad,
    feedItemType: "sponsored_ad",
    campaign,
    relatedProducts,
  };
}

module.exports = {
  deliverAds,
  getAdForDetail,
  matchesTargeting,
};
