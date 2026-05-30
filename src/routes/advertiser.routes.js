const express = require("express");
const {
  BUDGET_PLANS,
  AD_CTA_TYPES,
  AD_INTERESTS,
} = require("../config/adPricing");
const {
  getOrCreateAdvertiser,
  createCampaignWithAd,
  initiateCampaignPayment,
  syncCampaignPaymentStatus,
  pauseCampaign,
  resumeCampaign,
  topUpWallet,
  listAdvertiserCampaigns,
  getCampaignDetail,
} = require("../services/advertising.service");
const { getAdvertiserRevenueSummary } = require("../services/adAnalytics.service");
const { handleStkCallback } = require("../services/mpesaCallback.service");

module.exports = () => {
  const router = express.Router();

  /** GET /api/advertiser/plans */
  router.get("/plans", (_req, res) => {
    res.json({ plans: Object.values(BUDGET_PLANS), ctaTypes: AD_CTA_TYPES, interests: AD_INTERESTS });
  });

  /** GET /api/advertiser/profile/:clerkId */
  router.get("/profile/:clerkId", async (req, res) => {
    try {
      const advertiser = await getOrCreateAdvertiser(req.params.clerkId);
      const summary = await getAdvertiserRevenueSummary(req.params.clerkId);
      res.json({ advertiser, summary });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message || "Server error" });
    }
  });

  /** PUT /api/advertiser/profile */
  router.put("/profile", async (req, res) => {
    try {
      const { clerkId, ...payload } = req.body;
      if (!clerkId) return res.status(400).json({ message: "clerkId required" });
      const advertiser = await getOrCreateAdvertiser(clerkId, payload);
      res.json(advertiser);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message || "Server error" });
    }
  });

  /** GET /api/advertiser/campaigns/:clerkId */
  router.get("/campaigns/:clerkId", async (req, res) => {
    try {
      const campaigns = await listAdvertiserCampaigns(req.params.clerkId);
      res.json(campaigns);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** GET /api/advertiser/campaigns/:clerkId/:campaignId */
  router.get("/campaigns/:clerkId/:campaignId", async (req, res) => {
    try {
      const detail = await getCampaignDetail(
        req.params.campaignId,
        req.params.clerkId,
      );
      if (!detail) return res.status(404).json({ message: "Not found" });
      res.json(detail);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/advertiser/campaigns */
  router.post("/campaigns", async (req, res) => {
    try {
      const { clerkId, campaign, creative } = req.body;
      if (!clerkId || !campaign?.name || !campaign?.budgetTotal) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const result = await createCampaignWithAd({ clerkId, campaign, creative });
      res.status(201).json(result);
    } catch (err) {
      console.error(err);
      res.status(400).json({ message: err.message || "Server error" });
    }
  });

  /** POST /api/advertiser/campaigns/:campaignId/pay */
  router.post("/campaigns/:campaignId/pay", async (req, res) => {
    try {
      const { clerkId, method, phoneNumber } = req.body;
      if (!clerkId || !method) {
        return res.status(400).json({ message: "Missing fields" });
      }

      const result = await initiateCampaignPayment({
        campaignId: req.params.campaignId,
        clerkId,
        method,
        phoneNumber,
      });

      res.json(result);
    } catch (err) {
      console.error("campaign pay error:", err);
      const msg = err.message || "Server error";
      const status =
        msg.includes("M-Pesa") || msg.includes("phone") || msg.includes("Invalid")
          ? 400
          : 400;
      res.status(status).json({ success: false, message: msg });
    }
  });

  /** GET /api/advertiser/campaigns/:campaignId/pay/status/:checkoutRequestId */
  router.get(
    "/campaigns/:campaignId/pay/status/:checkoutRequestId",
    async (req, res) => {
      try {
        const payment = await syncCampaignPaymentStatus(
          req.params.checkoutRequestId,
        );
        if (!payment) {
          return res.status(404).json({
            success: false,
            status: "unknown",
            message: "Payment not found",
          });
        }
        if (
          String(payment.campaignId) !== String(req.params.campaignId)
        ) {
          return res.status(404).json({
            success: false,
            status: "unknown",
            message: "Payment not found for this campaign",
          });
        }
        return res.json({
          success: true,
          status: payment.status,
          amount: payment.amount,
        });
      } catch (err) {
        console.error("campaign pay status error:", err);
        return res.status(500).json({
          success: false,
          status: "unknown",
          message: err.message || "Status check failed",
        });
      }
    },
  );

  /** POST /api/advertiser/campaigns/:campaignId/pause */
  router.post("/campaigns/:campaignId/pause", async (req, res) => {
    try {
      const { clerkId } = req.body;
      const campaign = await pauseCampaign(req.params.campaignId, clerkId);
      if (!campaign) return res.status(404).json({ message: "Not found" });
      res.json(campaign);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/advertiser/campaigns/:campaignId/resume */
  router.post("/campaigns/:campaignId/resume", async (req, res) => {
    try {
      const { clerkId } = req.body;
      const campaign = await resumeCampaign(req.params.campaignId, clerkId);
      res.json(campaign);
    } catch (err) {
      console.error(err);
      res.status(400).json({ message: err.message || "Server error" });
    }
  });

  /** POST /api/advertiser/wallet/topup */
  router.post("/wallet/topup", async (req, res) => {
    try {
      const { clerkId, amount, phoneNumber } = req.body;
      if (!clerkId || !amount || !phoneNumber) {
        return res.status(400).json({ message: "Missing fields" });
      }
      const result = await topUpWallet(clerkId, Number(amount), phoneNumber);
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(400).json({ message: err.message || "Server error" });
    }
  });

  /** POST /api/advertiser/mpesa/callback — alias for legacy Daraja URLs */
  router.post("/mpesa/callback", async (req, res) => {
    try {
      await handleStkCallback(req.body, null);
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    } catch (err) {
      console.error(err);
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }
  });

  return router;
};
