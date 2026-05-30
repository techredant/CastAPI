const Advertiser = require("../models/advertiser");
const AdCampaign = require("../models/adCampaign");
const SponsoredAd = require("../models/sponsoredAd");
const AdPayment = require("../models/adPayment");
const User = require("../models/user");
const {
  initiateStkPush,
  queryStkPush,
  classifyStkQueryResult,
  shouldSandboxAutoComplete,
  normalizePhone,
} = require("../../services/mpesa.service");
const { BUDGET_PLANS } = require("../config/adPricing");
const { getCampaignAnalytics } = require("./adAnalytics.service");

const CTA_LABELS = {
  shop_now: "Shop Now",
  learn_more: "Learn More",
  download: "Download",
  contact_us: "Contact Us",
  visit_website: "Visit Website",
  install_app: "Install App",
};

function generateInvoiceNumber() {
  return `INV-AD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function getOrCreateAdvertiser(clerkId, payload = {}) {
  let advertiser = await Advertiser.findOne({ clerkId });
  if (advertiser) {
    if (payload.businessName) {
      Object.assign(advertiser, payload);
      await advertiser.save();
    }
    return advertiser;
  }

  const user = await User.findOne({ clerkId });
  advertiser = await Advertiser.create({
    clerkId,
    businessName:
      payload.businessName ||
      user?.companyName ||
      `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
      "Business",
    businessLogo: payload.businessLogo || user?.image,
    email: payload.email || user?.email,
    isVerified: user?.isVerified || false,
  });
  return advertiser;
}

async function createCampaignWithAd({
  clerkId,
  campaign,
  creative,
}) {
  const advertiser = await getOrCreateAdvertiser(clerkId, {
    businessName: creative.businessName,
    businessLogo: creative.businessLogo,
  });

  if (advertiser.isBanned) {
    throw new Error("Advertiser account is banned");
  }

  const plan = BUDGET_PLANS[campaign.planId] || BUDGET_PLANS.starter;
  if (campaign.budgetTotal < plan.minBudget) {
    throw new Error(`Minimum budget is KES ${plan.minBudget}`);
  }

  const startsAt = new Date(campaign.startsAt);
  const endsAt = new Date(campaign.endsAt);
  if (endsAt <= startsAt) {
    throw new Error("End date must be after start date");
  }

  const adCampaign = await AdCampaign.create({
    advertiserId: advertiser._id,
    advertiserClerkId: clerkId,
    name: campaign.name,
    status: "pending_review",
    budgetTotal: campaign.budgetTotal,
    dailyBudget: campaign.dailyBudget,
    planId: campaign.planId || "starter",
    startsAt,
    endsAt,
    targeting: campaign.targeting || {},
    paymentStatus: "unpaid",
  });

  const sponsoredAd = await SponsoredAd.create({
    campaignId: adCampaign._id,
    advertiserId: advertiser._id,
    advertiserClerkId: clerkId,
    businessName: creative.businessName || advertiser.businessName,
    businessLogo: creative.businessLogo || advertiser.businessLogo,
    isVerified: advertiser.isVerified,
    label: creative.label || "Sponsored",
    mediaType: creative.mediaType || "image",
    media: creative.media || [],
    caption: creative.caption,
    ctaType: creative.ctaType || "learn_more",
    ctaLabel: creative.ctaLabel || CTA_LABELS[creative.ctaType] || "Learn More",
    ctaUrl: creative.ctaUrl,
    productId: creative.productId,
    isActive: true,
  });

  return { campaign: adCampaign, ad: sponsoredAd, advertiser };
}

async function initiateCampaignPayment({
  campaignId,
  clerkId,
  method,
  phoneNumber,
}) {
  const campaign = await AdCampaign.findOne({
    _id: campaignId,
    advertiserClerkId: clerkId,
  });
  if (!campaign) throw new Error("Campaign not found");

  const advertiser = await Advertiser.findById(campaign.advertiserId);
  if (!advertiser) throw new Error("Advertiser not found");

  const amount = campaign.budgetTotal;

  if (method === "wallet") {
    if (advertiser.walletBalance < amount) {
      throw new Error("Insufficient wallet balance");
    }
    advertiser.walletBalance -= amount;
    advertiser.totalSpend += amount;
    await advertiser.save();

    const payment = await AdPayment.create({
      campaignId: campaign._id,
      advertiserId: advertiser._id,
      advertiserClerkId: clerkId,
      amount,
      method: "wallet",
      status: "completed",
      invoiceNumber: generateInvoiceNumber(),
      walletTransactionId: `WALLET-${Date.now()}`,
    });

    campaign.paymentStatus = "paid";
    await campaign.save();

    return { payment, activated: true, mock: false };
  }

  const payment = await AdPayment.create({
    campaignId: campaign._id,
    advertiserId: advertiser._id,
    advertiserClerkId: clerkId,
    amount,
    method: method === "card" ? "card" : "mpesa",
    status: "pending",
    invoiceNumber: generateInvoiceNumber(),
  });

  if (method === "card") {
    return {
      payment,
      message: "Card checkout — integrate Stripe/Pesapal in production",
      checkoutUrl: null,
    };
  }

  if (!phoneNumber?.trim()) {
    throw new Error("M-Pesa phone number is required");
  }

  const normalized = normalizePhone(phoneNumber);
  if (!/^254[17]\d{8}$/.test(normalized)) {
    throw new Error(
      "Invalid M-Pesa phone. Use 07XXXXXXXX or +2547XXXXXXXX (sandbox test: 254708374149).",
    );
  }

  let stk;
  try {
    stk = await initiateStkPush({
      phoneNumber: normalized,
      amount,
      accountReference: `AD${String(campaign._id).slice(-8)}`,
      description: `Ad ${campaign.name}`.slice(0, 13),
    });
  } catch (stkErr) {
    payment.status = "failed";
    await payment.save();
    throw stkErr;
  }

  payment.mpesaCheckoutRequestId = stk.CheckoutRequestID;
  payment.mpesaMerchantRequestId = stk.MerchantRequestID;
  await payment.save();

  if (stk.mock) {
    await completeCampaignPayment(payment._id, {
      mpesaCheckoutRequestId: stk.CheckoutRequestID,
      mpesaMerchantRequestId: stk.MerchantRequestID,
    });
    return {
      success: true,
      payment,
      mock: true,
      activated: true,
      checkoutRequestId: stk.CheckoutRequestID,
      message: "Campaign paid (test mode).",
    };
  }

  return {
    success: true,
    payment,
    mock: false,
    activated: false,
    pending: true,
    checkoutRequestId: stk.CheckoutRequestID,
    message: "Complete M-Pesa on your phone.",
  };
}

async function syncCampaignPaymentStatus(checkoutRequestId) {
  const payment = await AdPayment.findOne({
    mpesaCheckoutRequestId: checkoutRequestId,
  });
  if (!payment) return null;

  if (
    payment.status === "pending" &&
    payment.mpesaCheckoutRequestId &&
    process.env.MPESA_MOCK !== "true"
  ) {
    try {
      const q = await queryStkPush(payment.mpesaCheckoutRequestId);
      const stkStatus = classifyStkQueryResult(q);
      if (stkStatus === "completed") {
        await completeCampaignPayment(payment._id, {
          mpesaCheckoutRequestId: checkoutRequestId,
        });
      } else if (stkStatus === "failed") {
        if (!shouldSandboxAutoComplete(payment)) {
          payment.status = "failed";
          await payment.save();
        }
      }
    } catch (pollErr) {
      console.error("ad campaign stk query:", pollErr.message);
    }

    if (payment.status === "pending" && shouldSandboxAutoComplete(payment)) {
      await completeCampaignPayment(payment._id, {
        mpesaCheckoutRequestId: checkoutRequestId,
      });
    }
  }

  return payment;
}

async function completeCampaignPayment(paymentId, checkoutIds = {}) {
  const payment = await AdPayment.findById(paymentId);
  if (!payment || payment.status === "completed") return payment;

  payment.status = "completed";
  Object.assign(payment, checkoutIds);
  await payment.save();

  const campaign = await AdCampaign.findById(payment.campaignId);
  if (campaign) {
    campaign.paymentStatus = "paid";
    await campaign.save();
  }

  const advertiser = await Advertiser.findById(payment.advertiserId);
  if (advertiser) {
    advertiser.totalSpend += payment.amount;
    await advertiser.save();
  }

  return payment;
}

async function approveCampaign(campaignId, adminId) {
  const campaign = await AdCampaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.paymentStatus !== "paid") {
    throw new Error("Campaign must be paid before approval");
  }

  campaign.status = "active";
  campaign.approvedAt = new Date();
  campaign.approvedBy = adminId;
  await campaign.save();
  return campaign;
}

async function rejectCampaign(campaignId, reason) {
  const campaign = await AdCampaign.findByIdAndUpdate(
    campaignId,
    {
      status: "rejected",
      rejectionReason: reason,
    },
    { new: true },
  );
  return campaign;
}

async function pauseCampaign(campaignId, clerkId, isAdmin = false) {
  const query = isAdmin ? { _id: campaignId } : { _id: campaignId, advertiserClerkId: clerkId };
  return AdCampaign.findOneAndUpdate(
    query,
    { status: "paused", pausedAt: new Date() },
    { new: true },
  );
}

async function resumeCampaign(campaignId, clerkId) {
  const campaign = await AdCampaign.findOne({
    _id: campaignId,
    advertiserClerkId: clerkId,
    paymentStatus: "paid",
  });
  if (!campaign) throw new Error("Campaign not found");
  if (new Date() > campaign.endsAt) throw new Error("Campaign has ended");

  campaign.status = "active";
  campaign.pausedAt = null;
  await campaign.save();
  return campaign;
}

async function topUpWallet(clerkId, amount, phoneNumber) {
  const advertiser = await getOrCreateAdvertiser(clerkId);
  const stk = await initiateStkPush({
    phoneNumber,
    amount,
    accountReference: `ADWALLET-${advertiser._id}`,
    description: "Ad wallet top-up",
  });

  if (stk.mock) {
    advertiser.walletBalance += amount;
    await advertiser.save();
    return { mock: true, walletBalance: advertiser.walletBalance };
  }

  return {
    mock: false,
    checkoutRequestId: stk.CheckoutRequestID,
    pendingAmount: amount,
  };
}

async function listAdvertiserCampaigns(clerkId) {
  return AdCampaign.find({ advertiserClerkId: clerkId })
    .sort({ createdAt: -1 })
    .lean();
}

async function getCampaignDetail(campaignId, clerkId) {
  const campaign = await AdCampaign.findOne({
    _id: campaignId,
    advertiserClerkId: clerkId,
  }).lean();
  if (!campaign) return null;

  const ads = await SponsoredAd.find({ campaignId }).lean();
  const payments = await AdPayment.find({ campaignId }).sort({ createdAt: -1 }).lean();
  const analytics = await getCampaignAnalytics(campaignId);

  return { campaign, ads, payments, analytics };
}

module.exports = {
  getOrCreateAdvertiser,
  createCampaignWithAd,
  initiateCampaignPayment,
  syncCampaignPaymentStatus,
  completeCampaignPayment,
  approveCampaign,
  rejectCampaign,
  pauseCampaign,
  resumeCampaign,
  topUpWallet,
  listAdvertiserCampaigns,
  getCampaignDetail,
  CTA_LABELS,
};
