const express = require("express");
const AdCampaign = require("../models/adCampaign");
const AdReport = require("../models/adReport");
const Advertiser = require("../models/advertiser");
const SponsoredAd = require("../models/sponsoredAd");
const AdPayment = require("../models/adPayment");
const { requireAdmin } = require("../middleware/ads.middleware");
const {
  approveCampaign,
  rejectCampaign,
  pauseCampaign,
} = require("../services/advertising.service");
const { MODERATION_REASONS } = require("../config/adPricing");

module.exports = () => {
  const router = express.Router();
  router.use(requireAdmin);

  /** GET /api/ads-admin/pending */
  router.get("/pending", async (_req, res) => {
    try {
      const campaigns = await AdCampaign.find({
        status: "pending_review",
        paymentStatus: "paid",
      })
        .sort({ createdAt: 1 })
        .lean();

      const ads = await SponsoredAd.find({
        campaignId: { $in: campaigns.map((c) => c._id) },
      }).lean();

      const adMap = ads.reduce((acc, ad) => {
        acc[String(ad.campaignId)] = ad;
        return acc;
      }, {});

      res.json(
        campaigns.map((c) => ({
          ...c,
          creative: adMap[String(c._id)],
        })),
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** GET /api/ads-admin/reports */
  router.get("/reports", async (_req, res) => {
    try {
      const reports = await AdReport.find({ status: "open" })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      res.json(reports);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** GET /api/ads-admin/revenue */
  router.get("/revenue", async (_req, res) => {
    try {
      const payments = await AdPayment.find({ status: "completed" }).lean();
      const total = payments.reduce((s, p) => s + p.amount, 0);
      const byMethod = payments.reduce((acc, p) => {
        acc[p.method] = (acc[p.method] || 0) + p.amount;
        return acc;
      }, {});

      res.json({
        totalRevenue: total,
        transactionCount: payments.length,
        byMethod,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** PATCH /api/ads-admin/campaigns/:id/approve */
  router.patch("/campaigns/:id/approve", async (req, res) => {
    try {
      const campaign = await approveCampaign(
        req.params.id,
        req.headers["x-admin-id"] || "admin",
      );
      res.json(campaign);
    } catch (err) {
      console.error(err);
      res.status(400).json({ message: err.message || "Server error" });
    }
  });

  /** PATCH /api/ads-admin/campaigns/:id/reject */
  router.patch("/campaigns/:id/reject", async (req, res) => {
    try {
      const { reason } = req.body;
      const campaign = await rejectCampaign(req.params.id, reason);
      res.json(campaign);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** PATCH /api/ads-admin/campaigns/:id/pause */
  router.patch("/campaigns/:id/pause", async (req, res) => {
    try {
      const campaign = await pauseCampaign(req.params.id, null, true);
      res.json(campaign);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** PATCH /api/ads-admin/advertisers/:clerkId/ban */
  router.patch("/advertisers/:clerkId/ban", async (req, res) => {
    try {
      const { reason } = req.body;
      const advertiser = await Advertiser.findOneAndUpdate(
        { clerkId: req.params.clerkId },
        { isBanned: true, banReason: reason, bannedAt: new Date() },
        { new: true },
      );

      await AdCampaign.updateMany(
        { advertiserClerkId: req.params.clerkId, status: "active" },
        { status: "paused" },
      );

      res.json(advertiser);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** GET /api/ads-admin/moderation-reasons */
  router.get("/moderation-reasons", (_req, res) => {
    res.json(MODERATION_REASONS);
  });

  return router;
};
