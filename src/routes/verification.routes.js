const express = require("express");
const crypto = require("crypto");
const User = require("../models/user");
const VerificationRequest = require("../models/verificationRequest");
const { initiateStkPush, queryStkPush } = require("../../services/mpesa.service");
const {
  VERIFICATION_PLANS,
  resolvePlanPricing,
  plansForApi,
  markVerificationPaid,
  applyVerificationToUser,
  revokeUserVerification,
  expireVerificationIfNeeded,
  notifyAdminsNewRequest,
} = require("../../services/verification.service");
const { sendPushNotification } = require("../../services/pushNotification.service");

module.exports = (io) => {
  const router = express.Router();

  const requireAdmin = (req, res, next) => {
    const key = req.headers["x-admin-key"];
    if (!process.env.ADMIN_API_KEY || key !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  };

  /** GET /api/verification/plans */
  router.get("/plans", (_req, res) => {
    res.json({ plans: plansForApi() });
  });

  /** GET /api/verification/status/:clerkId */
  router.get("/status/:clerkId", async (req, res) => {
    try {
      const { clerkId } = req.params;
      const user = await User.findOne({ clerkId });
      if (!user) return res.status(404).json({ message: "User not found" });

      await expireVerificationIfNeeded(user);

      const activeRequest = await VerificationRequest.findOne({
        clerkId,
        status: { $in: ["pending_payment", "pending_review", "approved"] },
      }).sort({ createdAt: -1 });

      res.json({
        isVerified: user.isVerified,
        verificationType: user.verificationType,
        verifiedAt: user.verifiedAt,
        verificationExpiresAt: user.verificationExpiresAt,
        activeRequest,
        canApply:
          !user.isVerified &&
          !["pending_payment", "pending_review"].includes(
            activeRequest?.status,
          ),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** POST /api/verification/apply */
  router.post("/apply", async (req, res) => {
    try {
      const {
        clerkId,
        verificationType,
        phoneNumber,
        fullName,
        businessName,
        idNumber,
        website,
        applicationReason,
        documentUrls,
        billingCycle = "yearly",
      } = req.body;

      if (!clerkId || !verificationType || !phoneNumber || !fullName) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const plan = VERIFICATION_PLANS[verificationType];
      const pricing = resolvePlanPricing(verificationType, billingCycle);
      if (!plan || !pricing) {
        return res.status(400).json({ message: "Invalid verification type" });
      }

      if (["business", "government"].includes(verificationType) && !businessName?.trim()) {
        return res
          .status(400)
          .json({ message: "Organization name is required for this verification type" });
      }

      const user = await User.findOne({ clerkId });
      if (!user) return res.status(404).json({ message: "User not found" });

      const blocking = await VerificationRequest.findOne({
        clerkId,
        status: { $in: ["pending_payment", "pending_review"] },
      });

      if (blocking) {
        return res.status(409).json({
          message: "You already have an active verification request",
          request: blocking,
        });
      }

      const paymentReference = `BV-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

      const request = await VerificationRequest.create({
        clerkId,
        verificationType,
        status: "pending_payment",
        fullName: fullName.trim(),
        businessName: (businessName || "").trim(),
        idNumber: (idNumber || "").trim(),
        website: (website || "").trim(),
        applicationReason: (applicationReason || "").trim(),
        documentUrls: Array.isArray(documentUrls) ? documentUrls : [],
        amount: pricing.amount,
        currency: pricing.currency,
        billingCycle: pricing.billingCycle,
        phoneNumber,
        paymentReference,
      });

      const stk = await initiateStkPush({
        phoneNumber,
        amount: pricing.amount,
        accountReference: paymentReference,
        description: "Verify",
      });

      request.mpesaCheckoutRequestId = stk.CheckoutRequestID;
      request.mpesaMerchantRequestId = stk.MerchantRequestID;
      await request.save();

      user.activeVerificationRequestId = request._id;
      await user.save();

      if (process.env.MPESA_MOCK === "true") {
        await markVerificationPaid(request);
        await notifyAdminsNewRequest(io, request, user);

        if (user.expoPushToken) {
          await sendPushNotification(
            user.expoPushToken,
            "Payment received",
            "Your verification application is under review.",
            { screen: "verification" },
          );
        }
      }

      res.status(201).json({
        request,
        stk,
        message:
          process.env.MPESA_MOCK === "true"
            ? "Mock payment successful. Application submitted for review."
            : "Check your phone to complete M-Pesa payment.",
      });
    } catch (err) {
      console.error("verification apply:", err.message);
      res.status(500).json({ message: err.message || "Server error" });
    }
  });

  /** POST /api/verification/mpesa/callback */
  router.post("/mpesa/callback", async (req, res) => {
    try {
      const body = req.body?.Body?.stkCallback || req.body;
      const checkoutId = body?.CheckoutRequestID;
      const resultCode = String(body?.ResultCode ?? "");

      if (!checkoutId) {
        return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
      }

      const request = await VerificationRequest.findOne({
        mpesaCheckoutRequestId: checkoutId,
      });

      if (!request) {
        return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
      }

      if (resultCode === "0") {
        await markVerificationPaid(request);

        const user = await User.findOne({ clerkId: request.clerkId });
        await notifyAdminsNewRequest(io, request, user);

        if (user?.expoPushToken) {
          await sendPushNotification(
            user.expoPushToken,
            "Payment received ✓",
            "Your verification is pending admin review.",
            { screen: "verification" },
          );
        }
      } else if (request.status === "pending_payment") {
        request.status = "payment_failed";
        request.rejectionReason =
          body?.ResultDesc || "M-Pesa payment failed or cancelled";
        await request.save();
      }

      res.json({ ResultCode: 0, ResultDesc: "Success" });
    } catch (err) {
      console.error("mpesa callback:", err);
      res.json({ ResultCode: 0, ResultDesc: "Success" });
    }
  });

  /** POST /api/verification/poll/:requestId — client poll after STK */
  router.post("/poll/:requestId", async (req, res) => {
    try {
      const request = await VerificationRequest.findById(req.params.requestId);
      if (!request) return res.status(404).json({ message: "Not found" });

      if (
        request.status === "pending_payment" &&
        request.mpesaCheckoutRequestId
      ) {
        const q = await queryStkPush(request.mpesaCheckoutRequestId);
        if (String(q.ResultCode) === "0") {
          await markVerificationPaid(request);
          const user = await User.findOne({ clerkId: request.clerkId });
          await notifyAdminsNewRequest(io, request, user);
        }
      }

      res.json({ request });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  /* ========== ADMIN ========== */

  router.get("/admin/requests", requireAdmin, async (req, res) => {
    try {
      const status = req.query.status || "pending_review";
      const allowed = [
        "all",
        "pending_payment",
        "pending_review",
        "approved",
        "rejected",
        "payment_failed",
      ];
      const filter =
        !status || status === "all" || !allowed.includes(status)
          ? {}
          : { status };

      const requests = await VerificationRequest.find(filter)
        .sort({ createdAt: -1 })
        .limit(200);

      const enriched = await Promise.all(
        requests.map(async (r) => {
          const user = await User.findOne({ clerkId: r.clerkId }).select(
            "firstName lastName nickName email image companyName isVerified",
          );
          return { ...r.toObject(), user };
        }),
      );

      res.json({ requests: enriched });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  router.get("/admin/verified", requireAdmin, async (req, res) => {
    try {
      const users = await User.find({ isVerified: true })
        .select(
          "clerkId firstName lastName nickName email verificationType verifiedAt verificationExpiresAt image",
        )
        .sort({ verifiedAt: -1 })
        .limit(200);

      res.json({ users });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  router.patch("/admin/requests/:id/approve", requireAdmin, async (req, res) => {
    try {
      const request = await VerificationRequest.findById(req.params.id);
      if (!request) return res.status(404).json({ message: "Not found" });

      if (request.status !== "pending_review") {
        return res.status(400).json({ message: "Request is not pending review" });
      }

      const user = await User.findOne({ clerkId: request.clerkId });
      if (!user) return res.status(404).json({ message: "User not found" });

      request.reviewedBy = req.body.reviewedBy || "admin";
      await applyVerificationToUser(user, request);

      if (user.expoPushToken) {
        await sendPushNotification(
          user.expoPushToken,
          "You're verified! ✓",
          `Your ${request.verificationType} verification badge is now active.`,
          { screen: "verification" },
        );
      }

      res.json({ success: true, user, request });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.patch("/admin/requests/:id/reject", requireAdmin, async (req, res) => {
    try {
      const { reason } = req.body;
      const request = await VerificationRequest.findById(req.params.id);
      if (!request) return res.status(404).json({ message: "Not found" });

      request.status = "rejected";
      request.rejectionReason = reason || "Application rejected";
      request.reviewedAt = new Date();
      request.reviewedBy = req.body.reviewedBy || "admin";
      await request.save();

      const user = await User.findOne({ clerkId: request.clerkId });
      if (user) {
        user.activeVerificationRequestId = null;
        await user.save();
      }
      if (user?.expoPushToken) {
        await sendPushNotification(
          user.expoPushToken,
          "Verification update",
          request.rejectionReason,
          { screen: "verification" },
        );
      }

      res.json({ success: true, request });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  router.patch("/admin/users/:clerkId/revoke", requireAdmin, async (req, res) => {
    try {
      const user = await User.findOne({ clerkId: req.params.clerkId });
      if (!user) return res.status(404).json({ message: "User not found" });

      const request = user.activeVerificationRequestId
        ? await VerificationRequest.findById(user.activeVerificationRequestId)
        : null;

      await revokeUserVerification(
        user,
        request,
        req.body.reason || "Revoked by admin",
      );

      if (user.expoPushToken) {
        await sendPushNotification(
          user.expoPushToken,
          "Verification removed",
          "Your verified badge has been revoked.",
          { screen: "verification" },
        );
      }

      res.json({ success: true, user });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
