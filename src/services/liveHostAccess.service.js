const LiveHostAccess = require("../models/liveHostAccess");
const {
  HOST_ACCESS_TTL_MS,
  getHostAccessPlan,
} = require("../config/liveHostPricing");
const {
  initiateStkPush,
  queryStkPush,
  classifyStkQueryResult,
  shouldSandboxAutoComplete,
  normalizePhone,
} = require("../../services/mpesa.service");

async function hasActiveHostAccess(clerkId, callId) {
  const row = await LiveHostAccess.findOne({
    clerkId,
    callId,
    status: "completed",
    expiresAt: { $gt: new Date() },
  }).lean();
  return !!row;
}

async function initiateHostAccessPayment({
  clerkId,
  callId,
  streamKind,
  phoneNumber,
  roomTitle,
  productId,
}) {
  const plan = getHostAccessPlan(streamKind);
  if (!plan) throw new Error("Invalid stream type");

  const existing = await hasActiveHostAccess(clerkId, callId);
  if (existing) {
    return {
      success: true,
      activated: true,
      alreadyPaid: true,
      message: "Host access already active for this stream.",
    };
  }

  const normalized = normalizePhone(phoneNumber);
  if (!/^254[17]\d{8}$/.test(normalized)) {
    throw new Error(
      "Invalid M-Pesa phone. Use 07XXXXXXXX or +2547XXXXXXXX (sandbox: 254708374149).",
    );
  }

  const access = await LiveHostAccess.create({
    clerkId,
    callId,
    streamKind,
    roomTitle,
    productId,
    amount: plan.amount,
    phoneNumber: normalized,
    status: "pending",
  });

  let stk;
  try {
    stk = await initiateStkPush({
      phoneNumber: normalized,
      amount: plan.amount,
      accountReference: `LVH${String(callId).replace(/\W/g, "").slice(-7)}`,
      description: plan.label.slice(0, 13),
    });
  } catch (stkErr) {
    access.status = "failed";
    await access.save();
    throw stkErr;
  }

  access.mpesaCheckoutRequestId = stk.CheckoutRequestID;
  access.mpesaMerchantRequestId = stk.MerchantRequestID;
  await access.save();

  if (stk.mock) {
    await finalizeHostAccess(access);
    return {
      success: true,
      activated: true,
      mock: true,
      checkoutRequestId: stk.CheckoutRequestID,
      amount: plan.amount,
      streamKind,
      message: "Host access granted (test mode).",
    };
  }

  return {
    success: true,
    activated: false,
    pending: true,
    checkoutRequestId: stk.CheckoutRequestID,
    amount: plan.amount,
    streamKind,
    label: plan.label,
    message: "Complete M-Pesa on your phone to go live.",
  };
}

async function finalizeHostAccess(accessDoc) {
  if (!accessDoc || accessDoc.status === "completed") return accessDoc;

  const paidAt = new Date();
  accessDoc.status = "completed";
  accessDoc.paidAt = paidAt;
  accessDoc.expiresAt = new Date(paidAt.getTime() + HOST_ACCESS_TTL_MS);
  await accessDoc.save();
  return accessDoc;
}

async function syncHostAccessPayment(checkoutRequestId) {
  const access = await LiveHostAccess.findOne({
    mpesaCheckoutRequestId: checkoutRequestId,
  });
  if (!access) return null;

  if (
    access.status === "pending" &&
    access.mpesaCheckoutRequestId &&
    process.env.MPESA_MOCK !== "true"
  ) {
    try {
      const q = await queryStkPush(access.mpesaCheckoutRequestId);
      const stkStatus = classifyStkQueryResult(q);
      if (stkStatus === "completed") {
        await finalizeHostAccess(access);
      } else if (stkStatus === "failed") {
        if (!shouldSandboxAutoComplete(access)) {
          access.status = "failed";
          await access.save();
        }
      }
    } catch (pollErr) {
      console.error("host access stk query:", pollErr.message);
    }

    if (access.status === "pending" && shouldSandboxAutoComplete(access)) {
      await finalizeHostAccess(access);
    }
  }

  return access;
}

module.exports = {
  hasActiveHostAccess,
  initiateHostAccessPayment,
  finalizeHostAccess,
  syncHostAccessPayment,
  getHostAccessPlan,
};
