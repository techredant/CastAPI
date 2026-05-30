const AdPayment = require("../models/adPayment");
const LivePayment = require("../models/livePayment");
const LiveHostAccess = require("../models/liveHostAccess");
const { finalizeHostAccess } = require("./liveHostAccess.service");
const ProductBoost = require("../models/productBoost");
const SellerSubscription = require("../models/sellerSubscription");
const VerificationRequest = require("../models/verificationRequest");
const User = require("../models/user");
const { completeCampaignPayment } = require("./advertising.service");
const {
  finalizeBoostPayment,
  finalizeSubscriptionPayment,
} = require("./marketplace.service");
const {
  markVerificationPaid,
  notifyAdminsNewRequest,
} = require("../../services/verification.service");
const { sendPushNotification } = require("../../services/pushNotification.service");

/**
 * Handle Safaricom STK callback (Body.stkCallback or flat payload).
 * Dispatches by mpesaCheckoutRequestId across payment types.
 */
async function handleStkCallback(body, io) {
  const stk = body?.Body?.stkCallback || body;
  const checkoutId = stk?.CheckoutRequestID;
  const resultCode = String(stk?.ResultCode ?? "");

  if (!checkoutId) {
    return { handled: false };
  }

  const adPayment = await AdPayment.findOne({
    mpesaCheckoutRequestId: checkoutId,
    status: "pending",
  });
  if (adPayment) {
    if (resultCode === "0") {
      await completeCampaignPayment(adPayment._id, {
        mpesaCheckoutRequestId: checkoutId,
      });
    } else {
      adPayment.status = "failed";
      await adPayment.save();
    }
    return { handled: true, type: "ad" };
  }

  const hostAccess = await LiveHostAccess.findOne({
    mpesaCheckoutRequestId: checkoutId,
    status: "pending",
  });
  if (hostAccess) {
    if (resultCode === "0") {
      await finalizeHostAccess(hostAccess);
    } else {
      hostAccess.status = "failed";
      await hostAccess.save();
    }
    return { handled: true, type: "live_host_access" };
  }

  const livePayment = await LivePayment.findOne({
    mpesaCheckoutRequestId: checkoutId,
  });
  if (livePayment) {
    if (resultCode === "0") {
      livePayment.status = "completed";
    } else {
      livePayment.status = "failed";
    }
    await livePayment.save();

    if (livePayment.status === "completed" && livePayment.callId && io) {
      io.to(livePayment.callId).emit("live_payment_completed", {
        callId: livePayment.callId,
        type: livePayment.type,
        giftId: livePayment.giftId,
        amount: livePayment.amount,
        clerkId: livePayment.clerkId,
        senderName: livePayment.senderName,
        checkoutRequestId: checkoutId,
      });
    }
    return { handled: true, type: "live" };
  }

  const verification = await VerificationRequest.findOne({
    mpesaCheckoutRequestId: checkoutId,
  });
  if (verification) {
    if (resultCode === "0" && verification.status === "pending_payment") {
      await markVerificationPaid(verification);

      const user = await User.findOne({ clerkId: verification.clerkId });
      if (io) {
        await notifyAdminsNewRequest(io, verification, user);
      }

      if (user?.expoPushToken) {
        await sendPushNotification(
          user.expoPushToken,
          "Payment received",
          "Your verification is pending admin review.",
          { screen: "verification" },
        );
      }
    } else if (verification.status === "pending_payment") {
      verification.status = "payment_failed";
      verification.rejectionReason =
        stk?.ResultDesc || "M-Pesa payment failed or cancelled";
      await verification.save();
    }
    return { handled: true, type: "verification" };
  }

  const boost = await ProductBoost.findOne({
    mpesaCheckoutRequestId: checkoutId,
    status: "pending_payment",
  });
  if (boost) {
    if (resultCode === "0") {
      await finalizeBoostPayment(boost);
    } else {
      boost.status = "cancelled";
      await boost.save();
    }
    return { handled: true, type: "boost" };
  }

  const subscription = await SellerSubscription.findOne({
    mpesaCheckoutRequestId: checkoutId,
    status: "pending_payment",
  });
  if (subscription) {
    if (resultCode === "0") {
      await finalizeSubscriptionPayment(subscription);
      await User.findOneAndUpdate(
        { clerkId: subscription.userId },
        { isPremiumSeller: true },
      );
    } else {
      subscription.status = "cancelled";
      await subscription.save();
    }
    return { handled: true, type: "subscription" };
  }

  return { handled: false };
}

module.exports = { handleStkCallback };
