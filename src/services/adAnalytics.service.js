const AdDailyAnalytics = require("../models/adDailyAnalytics");
const AdImpression = require("../models/adImpression");
const AdClick = require("../models/adClick");
const AdCampaign = require("../models/adCampaign");
const { BUDGET_PLANS } = require("../config/adPricing");

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function bumpDaily(campaignId, adId, patch) {
  const date = todayKey();
  await AdDailyAnalytics.findOneAndUpdate(
    { campaignId, date },
    {
      $setOnInsert: { adId: adId || undefined },
      $inc: patch,
    },
    { upsert: true, new: true },
  );
}

async function recordImpression({
  adId,
  campaignId,
  viewerClerkId,
  sessionId,
  levelType,
  levelValue,
  watchTimeMs = 0,
  isFraudSuspect = false,
}) {
  if (isFraudSuspect) return null;

  const impression = await AdImpression.create({
    adId,
    campaignId,
    viewerClerkId,
    sessionId,
    levelType,
    levelValue,
    watchTimeMs,
  });

  await bumpDaily(campaignId, adId, {
    impressions: 1,
    reach: viewerClerkId ? 1 : 0,
    videoWatchTimeMs: watchTimeMs || 0,
  });

  const campaign = await AdCampaign.findById(campaignId);
  if (campaign) {
    const plan = BUDGET_PLANS[campaign.planId] || BUDGET_PLANS.starter;
    const impressionCost = plan.cpm / 1000;
    campaign.impressionsDelivered += 1;
    campaign.budgetSpent = Math.min(
      campaign.budgetTotal,
      (campaign.budgetSpent || 0) + impressionCost,
    );
    if (
      campaign.budgetSpent >= campaign.budgetTotal ||
      new Date() > campaign.endsAt
    ) {
      campaign.status = "completed";
      campaign.completedAt = new Date();
    }
    await campaign.save();
    await bumpDaily(campaignId, adId, { spend: impressionCost });
  }

  return impression;
}

async function recordClick({
  adId,
  campaignId,
  viewerClerkId,
  clickType = "cta",
  isFraudSuspect = false,
}) {
  if (isFraudSuspect) return null;

  const click = await AdClick.create({
    adId,
    campaignId,
    viewerClerkId,
    clickType,
  });

  await bumpDaily(campaignId, adId, { clicks: 1, engagements: 1 });

  await AdCampaign.findByIdAndUpdate(campaignId, {
    $inc: { clicksDelivered: 1 },
  });

  return click;
}

async function recordEngagement(campaignId, adId, type) {
  const inc = {};
  if (type === "save") inc.saves = 1;
  else inc.engagements = 1;
  await bumpDaily(campaignId, adId, inc);
}

async function getCampaignAnalytics(campaignId, days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceKey = since.toISOString().slice(0, 10);

  const daily = await AdDailyAnalytics.find({
    campaignId,
    date: { $gte: sinceKey },
  })
    .sort({ date: 1 })
    .lean();

  const totals = daily.reduce(
    (acc, row) => {
      acc.impressions += row.impressions || 0;
      acc.clicks += row.clicks || 0;
      acc.saves += row.saves || 0;
      acc.spend += row.spend || 0;
      acc.engagements += row.engagements || 0;
      return acc;
    },
    { impressions: 0, clicks: 0, saves: 0, spend: 0, engagements: 0 },
  );

  const ctr =
    totals.impressions > 0
      ? Math.round((totals.clicks / totals.impressions) * 10000) / 100
      : 0;

  return { daily, totals: { ...totals, ctr } };
}

async function getAdvertiserRevenueSummary(advertiserClerkId) {
  const campaigns = await AdCampaign.find({ advertiserClerkId }).lean();
  const active = campaigns.filter((c) => c.status === "active").length;
  const totalSpend = campaigns.reduce((s, c) => s + (c.budgetSpent || 0), 0);
  const totalBudget = campaigns.reduce((s, c) => s + (c.budgetTotal || 0), 0);

  return {
    campaignCount: campaigns.length,
    activeCampaigns: active,
    totalSpend,
    totalBudget,
  };
}

module.exports = {
  recordImpression,
  recordClick,
  recordEngagement,
  getCampaignAnalytics,
  getAdvertiserRevenueSummary,
  bumpDaily,
};
