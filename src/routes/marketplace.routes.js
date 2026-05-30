const express = require("express");
const ProductBoost = require("../models/productBoost");
const ProductReview = require("../models/productReview");
const ProductReport = require("../models/productReport");
const Product = require("../models/product");
const User = require("../models/user");
const { BOOST_PLANS, SELLER_SUBSCRIPTION } = require("../config/marketPricing");
const {
  getSellerAnalytics,
  initiateBoostPayment,
  initiateSubscriptionPayment,
  finalizeBoostPayment,
  syncBoostPaymentStatus,
  syncSubscriptionPaymentStatus,
  finalizeSubscriptionPayment,
  updateSellerRating,
} = require("../services/marketplace.service");
const { detectFraudWarnings } = require("../services/productRanking.service");

module.exports = () => {
  const router = express.Router();

  /** GET /api/marketplace/plans */
  router.get("/plans", (_req, res) => {
    res.json({
      boostPlans: Object.values(BOOST_PLANS),
      sellerSubscription: SELLER_SUBSCRIPTION,
    });
  });

  /** GET /api/marketplace/analytics/:userId */
  router.get("/analytics/:userId", async (req, res) => {
    try {
      const analytics = await getSellerAnalytics(req.params.userId);
      res.json(analytics);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/marketplace/boost/pay */
  router.post("/boost/pay", async (req, res) => {
    try {
      const { productId, userId, planId, phoneNumber } = req.body;
      if (!productId || !userId || !planId || !phoneNumber) {
        return res.status(400).json({ message: "Missing fields" });
      }

      const result = await initiateBoostPayment({
        productId,
        userId,
        planId,
        phoneNumber,
      });

      if (result.mock) {
        return res.json({
          success: true,
          activated: true,
          checkoutRequestId: result.checkoutRequestId,
          expiresAt: result.expiresAt,
          message: "Boost activated (test payment)",
        });
      }

      return res.json({
        success: true,
        activated: false,
        pending: true,
        checkoutRequestId: result.checkoutRequestId,
        message: "Complete M-Pesa on your phone",
      });
    } catch (err) {
      console.error("boost pay error:", err);
      const msg = err.message || "Server error";
      const status = msg.includes("Only the listing owner")
        ? 403
        : msg.includes("M-Pesa") || msg.includes("phone")
          ? 400
          : 500;
      res.status(status).json({ success: false, message: msg });
    }
  });

  /** GET /api/marketplace/boost/pay/status/:checkoutRequestId */
  router.get("/boost/pay/status/:checkoutRequestId", async (req, res) => {
    try {
      const boost = await syncBoostPaymentStatus(req.params.checkoutRequestId);
      if (!boost) {
        return res.status(404).json({
          success: false,
          status: "unknown",
          message: "Boost payment not found",
        });
      }

      return res.json({
        success: true,
        status: boost.status,
        expiresAt: boost.expiresAt,
        productId: boost.productId,
      });
    } catch (err) {
      console.error("boost pay status error:", err);
      return res.status(500).json({
        success: false,
        status: "unknown",
        message: err.message || "Status check failed",
      });
    }
  });

  /** POST /api/marketplace/boost/confirm-mock */
  router.post("/boost/confirm-mock", async (req, res) => {
    try {
      const { boostId, userId } = req.body;
      const boost = await ProductBoost.findById(boostId);
      if (!boost || boost.userId !== userId) {
        return res.status(404).json({ message: "Boost not found" });
      }

      const { product, expiresAt } = await finalizeBoostPayment(boost);

      res.json({ product, expiresAt });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/marketplace/subscribe/pay */
  router.post("/subscribe/pay", async (req, res) => {
    try {
      const { userId, phoneNumber } = req.body;
      if (!userId || !phoneNumber) {
        return res.status(400).json({ message: "Missing fields" });
      }

      const result = await initiateSubscriptionPayment({ userId, phoneNumber });

      if (result.mock) {
        await User.findOneAndUpdate(
          { clerkId: userId },
          { isPremiumSeller: true },
        );
        return res.json({
          success: true,
          activated: true,
          checkoutRequestId: result.checkoutRequestId,
          subscription: result.subscription,
          message: "Premium Seller activated (test payment)",
        });
      }

      return res.json({
        success: true,
        activated: false,
        pending: true,
        checkoutRequestId: result.checkoutRequestId,
        message: "Complete M-Pesa on your phone",
      });
    } catch (err) {
      const msg = err.message || "Server error";
      const status =
        msg.includes("M-Pesa") || msg.includes("phone") ? 400 : 500;
      res.status(status).json({ success: false, message: msg });
    }
  });

  /** GET /api/marketplace/subscribe/pay/status/:checkoutRequestId */
  router.get("/subscribe/pay/status/:checkoutRequestId", async (req, res) => {
    try {
      const sub = await syncSubscriptionPaymentStatus(
        req.params.checkoutRequestId,
      );
      if (!sub) {
        return res.status(404).json({
          success: false,
          status: "unknown",
          message: "Subscription payment not found",
        });
      }

      return res.json({
        success: true,
        status: sub.status,
        expiresAt: sub.expiresAt,
      });
    } catch (err) {
      console.error("subscription pay status error:", err);
      return res.status(500).json({
        success: false,
        status: "unknown",
        message: err.message || "Status check failed",
      });
    }
  });

  /** GET /api/marketplace/seller/:userId/reviews */
  router.get("/seller/:userId/reviews", async (req, res) => {
    try {
      const reviews = await ProductReview.find({
        sellerId: req.params.userId,
      })
        .sort({ createdAt: -1 })
        .limit(50);
      res.json(reviews);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  /** GET /api/marketplace/products/:productId/reviews */
  router.get("/products/:productId/reviews", async (req, res) => {
    try {
      const reviews = await ProductReview.find({
        productId: req.params.productId,
      })
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(req.query.limit) || 30, 50));
      res.json(reviews);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/marketplace/reviews */
  router.post("/reviews", async (req, res) => {
    try {
      const { productId, reviewerId, rating, comment } = req.body;
      if (!productId || !reviewerId || !rating) {
        return res.status(400).json({ message: "Missing fields" });
      }

      const product = await Product.findById(productId);
      if (!product) return res.status(404).json({ message: "Product not found" });
      if (product.userId === reviewerId) {
        return res.status(400).json({ message: "Cannot review your own listing" });
      }

      const review = await ProductReview.findOneAndUpdate(
        { productId, reviewerId },
        { sellerId: product.userId, rating, comment },
        { upsert: true, new: true },
      );

      await updateSellerRating(product.userId);
      res.status(201).json(review);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/marketplace/report */
  router.post("/report", async (req, res) => {
    try {
      const { productId, reporterId, reason, details } = req.body;
      if (!productId || !reporterId || !reason) {
        return res.status(400).json({ message: "Missing fields" });
      }

      const product = await Product.findById(productId);
      if (!product) return res.status(404).json({ message: "Not found" });

      const fraud = detectFraudWarnings({
        title: product.title,
        price: product.price,
        description: product.description,
        phoneNumber: product.phoneNumber,
      });

      const existing = await ProductReport.findOne({ productId, reporterId });
      if (existing) {
        return res.status(200).json({
          message: "You already reported this listing. Our team will review it.",
          reportId: existing._id,
          duplicate: true,
        });
      }

      const reportCount = await ProductReport.countDocuments({
        productId,
        status: { $in: ["pending", "action_taken"] },
      });
      const fraudScore = fraud.score + Math.min(30, reportCount * 10);

      const report = await ProductReport.create({
        productId,
        reporterId,
        reason,
        details,
        fraudScore,
      });

      if (fraudScore >= 30 || reportCount + 1 >= 3) {
        product.fraudFlags = {
          score: fraudScore,
          warnings: [
            ...new Set([
              ...(fraud.warnings || []),
              reportCount + 1 >= 3 ? "Multiple community reports" : null,
            ].filter(Boolean)),
          ],
        };
        if (product.status === "active") product.status = "flagged";
        await product.save();
      }

      res.status(201).json({
        message: "Report submitted. Our team will review this listing.",
        reportId: report._id,
      });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/marketplace/chat-started */
  router.post("/chat-started", async (req, res) => {
    try {
      const { productId } = req.body;
      if (productId) {
        await Product.findByIdAndUpdate(productId, { $inc: { chatCount: 1 } });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
