const express = require("express");
const LivePayment = require("../models/livePayment");
const LiveReaction = require("../models/liveReaction");
const User = require("../models/user");
const {
  initiateStkPush,
  queryStkPush,
  classifyStkQueryResult,
  shouldSandboxAutoComplete,
} = require("../../services/mpesa.service");
const { notify } = require("../services/notificationEngine.service");
const { LIVE_HOST_ACCESS } = require("../config/liveHostPricing");
const {
  hasActiveHostAccess,
  initiateHostAccessPayment,
  syncHostAccessPayment,
} = require("../services/liveHostAccess.service");

/** Avoid duplicate fan-out if the client retries notify-started. */
const liveNotifyCooldown = new Map();
const LIVE_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;

const GIFT_AMOUNTS = {
  rose: 10,
  heart: 20,
  star: 50,
  fire: 100,
  rocket: 200,
  lion: 500,
  universe: 1000,
};

module.exports = (io) => {
  const router = express.Router();

  /** GET /api/live/host-access/plans */
  router.get("/host-access/plans", (_req, res) => {
    res.json({ plans: Object.values(LIVE_HOST_ACCESS) });
  });

  /** GET /api/live/host-access/verify?clerkId=&callId= */
  router.get("/host-access/verify", async (req, res) => {
    try {
      const { clerkId, callId } = req.query;
      if (!clerkId || !callId) {
        return res.status(400).json({ message: "clerkId and callId required" });
      }
      const paid = await hasActiveHostAccess(String(clerkId), String(callId));
      return res.json({ success: true, paid });
    } catch (err) {
      return res.status(500).json({ message: err.message || "Server error" });
    }
  });

  /** POST /api/live/host-access/pay */
  router.post("/host-access/pay", async (req, res) => {
    try {
      const { clerkId, callId, streamKind, phoneNumber, roomTitle, productId } =
        req.body;
      if (!clerkId || !callId || !streamKind || !phoneNumber) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      if (!["community", "market"].includes(streamKind)) {
        return res.status(400).json({ message: "Invalid streamKind" });
      }

      const result = await initiateHostAccessPayment({
        clerkId,
        callId,
        streamKind,
        phoneNumber,
        roomTitle,
        productId,
      });

      return res.json(result);
    } catch (err) {
      console.error("host access pay error:", err);
      const msg = err.message || "Payment failed";
      const status =
        msg.includes("M-Pesa") || msg.includes("phone") || msg.includes("Invalid")
          ? 400
          : 400;
      return res.status(status).json({ success: false, message: msg });
    }
  });

  /** GET /api/live/host-access/pay/status/:checkoutRequestId */
  router.get("/host-access/pay/status/:checkoutRequestId", async (req, res) => {
    try {
      const access = await syncHostAccessPayment(req.params.checkoutRequestId);
      if (!access) {
        return res.status(404).json({
          success: false,
          status: "unknown",
          message: "Payment not found",
        });
      }
      return res.json({
        success: true,
        status: access.status,
        callId: access.callId,
        streamKind: access.streamKind,
        expiresAt: access.expiresAt,
      });
    } catch (err) {
      console.error("host access pay status error:", err);
      return res.status(500).json({
        success: false,
        status: "unknown",
        message: err.message || "Status check failed",
      });
    }
  });

  router.post("/notify-started", async (req, res) => {
    try {
      const { hostClerkId, callId, title } = req.body;

      if (!hostClerkId || !callId) {
        return res.status(400).json({ message: "hostClerkId and callId are required" });
      }

      const cacheKey = `${hostClerkId}:${callId}`;
      const lastSent = liveNotifyCooldown.get(cacheKey);
      if (lastSent && Date.now() - lastSent < LIVE_NOTIFY_COOLDOWN_MS) {
        return res.json({ ok: true, skipped: "cooldown" });
      }
      liveNotifyCooldown.set(cacheKey, Date.now());

      const host = await User.findOne({ clerkId: hostClerkId });
      if (!host) {
        return res.status(404).json({ message: "Host not found" });
      }

      const followerIds = Array.isArray(host.followers) ? host.followers : [];
      if (followerIds.length === 0) {
        return res.json({ ok: true, notified: 0 });
      }

      const followers = await User.find({ clerkId: { $in: followerIds } });
      const displayName =
        host.nickName || host.firstName || host.companyName || "Someone";
      const liveTitle = title || "Live";
      const pushTitle = "🔴 Live now";
      const pushBody = `${displayName} is live: ${liveTitle}`;

      let pushCount = 0;

      for (const follower of followers) {
        if (follower.clerkId === hostClerkId) continue;

        await notify({
          userId: follower.clerkId,
          type: "livestream_started",
          title: pushTitle,
          body: pushBody,
          actor: {
            userId: host.clerkId,
            name: displayName,
            image: host.image,
          },
          entityId: String(callId),
          entityType: "live",
          data: {
            screen: "live",
            callId: String(callId),
            category: "livestreams",
            authorId: host.clerkId,
            url: `/(drawer)/(live)?callId=${encodeURIComponent(String(callId))}`,
          },
          io,
          dedupeWindowMs: LIVE_NOTIFY_COOLDOWN_MS,
        });
        pushCount += 1;
      }

      return res.json({
        ok: true,
        notified: followers.length,
        pushSent: pushCount,
      });
    } catch (err) {
      console.error("live notify-started error:", err);
      return res.status(500).json({
        message: err.message || "Could not notify followers",
      });
    }
  });

  router.post("/pay", async (req, res) => {
    try {
      const { clerkId, callId, phoneNumber, type, giftId, amount, hostUserId, senderName } =
        req.body;

      if (!clerkId || !callId || !phoneNumber || !type) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      let kes = Number(amount);
      if (type === "gift") {
        if (!giftId || !GIFT_AMOUNTS[giftId]) {
          return res.status(400).json({ message: "Invalid gift" });
        }
        kes = GIFT_AMOUNTS[giftId];
      }

      if (!Number.isFinite(kes) || kes < 10) {
        return res.status(400).json({ message: "Minimum amount is KES 10" });
      }

      const payment = await LivePayment.create({
        clerkId,
        callId,
        hostUserId: hostUserId || undefined,
        type,
        giftId: type === "gift" ? giftId : undefined,
        amount: kes,
        phoneNumber,
        senderName,
        status: "pending",
      });

      let stk;
      try {
        const normalizedPhone = String(phoneNumber).trim().replace(/^\+/, "");
        stk = await initiateStkPush({
          phoneNumber: normalizedPhone,
          amount: kes,
          accountReference: `LIVE${String(callId).replace(/\W/g, "").slice(0, 8)}`,
          description: type === "gift" ? "Live gift" : "Live donation",
        });
      } catch (stkErr) {
        payment.status = "failed";
        await payment.save();
        return res.status(400).json({
          success: false,
          message: stkErr.message || "Could not start M-Pesa payment",
        });
      }

      payment.mpesaCheckoutRequestId = stk.CheckoutRequestID;
      payment.mpesaMerchantRequestId = stk.MerchantRequestID;
      await payment.save();

      if (process.env.MPESA_MOCK === "true") {
        payment.status = "completed";
        await payment.save();
        if (io && payment.callId) {
          io.to(payment.callId).emit("live_payment_completed", {
            callId: payment.callId,
            type: payment.type,
            giftId: payment.giftId,
            amount: payment.amount,
            clerkId: payment.clerkId,
            senderName: payment.senderName,
            checkoutRequestId: stk.CheckoutRequestID,
          });
        }
        return res.json({
          success: true,
          mock: true,
          message: "Mock payment completed",
          checkoutRequestId: stk.CheckoutRequestID,
        });
      }

      return res.json({
        success: true,
        pending: true,
        message: "Complete M-Pesa on your phone",
        checkoutRequestId: stk.CheckoutRequestID,
      });
    } catch (err) {
      console.error("live pay error:", err);
      return res.status(400).json({
        success: false,
        message: err.message || "Payment failed",
      });
    }
  });

  router.get("/pay/status/:checkoutRequestId", async (req, res) => {
    try {
      const payment = await LivePayment.findOne({
        mpesaCheckoutRequestId: req.params.checkoutRequestId,
      });

      if (!payment) {
        return res.status(404).json({
          success: false,
          status: "unknown",
          message: "Payment not found",
        });
      }

      if (
        payment.status === "pending" &&
        payment.mpesaCheckoutRequestId &&
        process.env.MPESA_MOCK !== "true"
      ) {
        try {
          const q = await queryStkPush(payment.mpesaCheckoutRequestId);
          const stkStatus = classifyStkQueryResult(q);
          if (stkStatus === "completed") {
            payment.status = "completed";
            await payment.save();
            if (io && payment.callId) {
              io.to(payment.callId).emit("live_payment_completed", {
                callId: payment.callId,
                type: payment.type,
                giftId: payment.giftId,
                amount: payment.amount,
                clerkId: payment.clerkId,
                senderName: payment.senderName,
                checkoutRequestId: payment.mpesaCheckoutRequestId,
              });
            }
          } else if (stkStatus === "failed") {
            if (!shouldSandboxAutoComplete(payment)) {
              payment.status = "failed";
              await payment.save();
            }
          }
        } catch (pollErr) {
          console.error("live pay stk query:", pollErr.message);
        }

        if (payment.status === "pending" && shouldSandboxAutoComplete(payment)) {
          payment.status = "completed";
          await payment.save();
          if (io && payment.callId) {
            io.to(payment.callId).emit("live_payment_completed", {
              callId: payment.callId,
              type: payment.type,
              giftId: payment.giftId,
              amount: payment.amount,
              clerkId: payment.clerkId,
              senderName: payment.senderName,
              checkoutRequestId: payment.mpesaCheckoutRequestId,
            });
          }
        }
      }

      return res.json({
        success: true,
        status: payment.status,
        type: payment.type,
        giftId: payment.giftId,
        amount: payment.amount,
      });
    } catch (err) {
      console.error("live pay status error:", err);
      return res.status(500).json({
        success: false,
        status: "unknown",
        message: err.message || "Status check failed",
      });
    }
  });

  router.post("/mpesa/callback", async (req, res) => {
    try {
      const body = req.body?.Body?.stkCallback;
      const checkoutId = body?.CheckoutRequestID;
      const resultCode = body?.ResultCode;

      if (!checkoutId) {
        return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
      }

      const payment = await LivePayment.findOne({ mpesaCheckoutRequestId: checkoutId });
      if (!payment) {
        return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
      }

      if (String(resultCode) === "0") {
        payment.status = "completed";
      } else {
        payment.status = "failed";
      }
      await payment.save();

      if (payment.status === "completed" && payment.callId) {
        io.to(payment.callId).emit("live_payment_completed", {
          callId: payment.callId,
          type: payment.type,
          giftId: payment.giftId,
          amount: payment.amount,
          clerkId: payment.clerkId,
          senderName: payment.senderName,
          checkoutRequestId: checkoutId,
        });
      }

      return res.json({ ResultCode: 0, ResultDesc: "Success" });
    } catch (err) {
      console.error("live mpesa callback:", err);
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }
  });

  /** POST /api/live/:callId/reactions — lightweight reaction analytics */
  router.post("/:callId/reactions", async (req, res) => {
    try {
      const { callId } = req.params;
      const { reactionType } = req.body;

      if (!callId || !reactionType) {
        return res
          .status(400)
          .json({ message: "callId and reactionType are required" });
      }

      const allowed = ["heart", "like", "fire", "laugh"];
      if (!allowed.includes(reactionType)) {
        return res.status(400).json({ message: "Invalid reactionType" });
      }

      const doc = await LiveReaction.findOneAndUpdate(
        { livestreamId: callId, reactionType },
        { $inc: { count: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      return res.json({
        livestreamId: doc.livestreamId,
        reactionType: doc.reactionType,
        count: doc.count,
      });
    } catch (err) {
      console.error("live reaction analytics:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });

  /** GET /api/live/:callId/reactions */
  router.get("/:callId/reactions", async (req, res) => {
    try {
      const rows = await LiveReaction.find({
        livestreamId: req.params.callId,
      }).lean();
      return res.json(rows);
    } catch (err) {
      console.error("live reaction fetch:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
