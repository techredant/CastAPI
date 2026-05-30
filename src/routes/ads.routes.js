const express = require("express");
const SponsoredAd = require("../models/sponsoredAd");
const AdReport = require("../models/adReport");
const { deliverAds, getAdForDetail } = require("../services/adDelivery.service");
const {
  recordImpression,
  recordClick,
  recordEngagement,
} = require("../services/adAnalytics.service");
const { adsRateLimit } = require("../middleware/ads.middleware");
const {
  BUDGET_PLANS,
  AD_CTA_TYPES,
  AD_INTERESTS,
  AD_MARKETPLACE_BEHAVIORS,
  FEED_AD_INTERVAL,
} = require("../config/adPricing");

module.exports = () => {
  const router = express.Router();

  /** GET /api/ads/config */
  router.get("/config", (_req, res) => {
    res.json({
      budgetPlans: Object.values(BUDGET_PLANS),
      ctaTypes: AD_CTA_TYPES,
      interests: AD_INTERESTS,
      marketplaceBehaviors: AD_MARKETPLACE_BEHAVIORS,
      feedAdInterval: FEED_AD_INTERVAL,
    });
  });

  /** GET /api/ads/delivery — ads to inject in feed */
  router.get("/delivery", async (req, res) => {
    try {
      const {
        viewerClerkId,
        levelType,
        levelValue,
        limit = 3,
        excludeAdIds,
      } = req.query;

      const exclude = excludeAdIds
        ? String(excludeAdIds).split(",").filter(Boolean)
        : [];

      const ads = await deliverAds({
        viewerClerkId,
        levelType,
        levelValue,
        limit: Math.min(Number(limit) || 3, 5),
        excludeAdIds: exclude,
      });

      res.json({ ads, feedAdInterval: FEED_AD_INTERVAL });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to load ads" });
    }
  });

  /** GET /api/ads/:adId — ad detail page */
  router.get("/:adId", async (req, res) => {
    try {
      const { viewerClerkId } = req.query;
      const detail = await getAdForDetail(req.params.adId, viewerClerkId);
      if (!detail) {
        return res.status(404).json({ message: "Ad not found" });
      }
      res.json(detail);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/ads/:adId/impression */
  router.post(
    "/:adId/impression",
    adsRateLimit("impression"),
    async (req, res) => {
      try {
        const ad = await SponsoredAd.findById(req.params.adId);
        if (!ad) return res.status(404).json({ message: "Ad not found" });

        const fraudSuspect = req.body?.fraudSuspect === true;
        await recordImpression({
          adId: ad._id,
          campaignId: ad.campaignId,
          viewerClerkId: req.body?.viewerClerkId,
          sessionId: req.body?.sessionId,
          levelType: req.body?.levelType,
          levelValue: req.body?.levelValue,
          watchTimeMs: req.body?.watchTimeMs || 0,
          isFraudSuspect: fraudSuspect,
        });

        res.json({ ok: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    },
  );

  /** POST /api/ads/:adId/click */
  router.post("/:adId/click", adsRateLimit("click"), async (req, res) => {
    try {
      const ad = await SponsoredAd.findById(req.params.adId);
      if (!ad) return res.status(404).json({ message: "Ad not found" });

      await recordClick({
        adId: ad._id,
        campaignId: ad.campaignId,
        viewerClerkId: req.body?.viewerClerkId,
        clickType: req.body?.clickType || "cta",
        isFraudSuspect: req.body?.fraudSuspect === true,
      });

      res.json({ ok: true, ctaUrl: ad.ctaUrl });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/ads/:adId/engage — like, save, share */
  router.post("/:adId/engage", async (req, res) => {
    try {
      const { type, viewerClerkId } = req.body;
      const ad = await SponsoredAd.findById(req.params.adId);
      if (!ad) return res.status(404).json({ message: "Ad not found" });

      const inc = {};
      if (type === "like") inc.likeCount = 1;
      if (type === "share") inc.shareCount = 1;
      if (type === "save") inc.saveCount = 1;
      if (type === "comment") inc.commentCount = 1;

      if (Object.keys(inc).length) {
        await SponsoredAd.findByIdAndUpdate(ad._id, { $inc: inc });
        await recordEngagement(ad.campaignId, ad._id, type);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/ads/:adId/hide */
  router.post("/:adId/hide", async (req, res) => {
    try {
      const { viewerClerkId } = req.body;
      if (!viewerClerkId) {
        return res.status(400).json({ message: "viewerClerkId required" });
      }
      await SponsoredAd.findByIdAndUpdate(req.params.adId, {
        $addToSet: { hiddenByUsers: viewerClerkId },
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/ads/:adId/report */
  router.post("/:adId/report", async (req, res) => {
    try {
      const { reporterClerkId, reason, details } = req.body;
      if (!reporterClerkId || !reason) {
        return res.status(400).json({ message: "Missing fields" });
      }

      const ad = await SponsoredAd.findById(req.params.adId);
      if (!ad) return res.status(404).json({ message: "Ad not found" });

      await AdReport.create({
        adId: ad._id,
        campaignId: ad.campaignId,
        reporterClerkId,
        reason,
        details,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
