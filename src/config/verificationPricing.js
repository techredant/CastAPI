/** Verification plans (KES) */
const VERIFICATION_PLANS = {
  personal: {
    type: "personal",
    label: "Personal Verification",
    description: "Blue badge, higher trust, priority support, better reach.",
    badge: "blue",
    currency: "KES",
    features: [
      "Blue verified badge",
      "Higher trust on posts & profile",
      "Priority support",
      "Better reach in feed",
    ],
    pricing: {
      monthly: { amount: 300, durationDays: 30 },
      yearly: { amount: 4000, durationDays: 365 },
    },
  },
  business: {
    type: "business",
    label: "Business Verification",
    description: "Gold badge, business tools, analytics, ads & marketplace trust.",
    badge: "gold",
    currency: "KES",
    features: [
      "Gold verified badge",
      "Business profile tools",
      "Analytics insights",
      "Ads & marketplace priority",
    ],
    pricing: {
      monthly: { amount: 1499, durationDays: 30 },
      yearly: { amount: 15000, durationDays: 365 },
    },
  },
  government: {
    type: "government",
    label: "Government Verification",
    description: "Red badge for official government accounts and public offices.",
    badge: "red",
    currency: "KES",
    features: [
      "Red government badge",
      "Official public office identity",
      "Priority review",
      "Higher public trust",
    ],
    pricing: {
      monthly: { amount: 3500, maxAmount: 7000, durationDays: 30 },
      yearly: { amount: 35000, maxAmount: 70000, durationDays: 365 },
    },
  },
};

function resolvePlanPricing(verificationType, billingCycle = "yearly") {
  const plan = VERIFICATION_PLANS[verificationType];
  if (!plan) return null;
  const cycle = plan.pricing[billingCycle] || plan.pricing.yearly;
  return {
    amount: cycle.amount,
    maxAmount: cycle.maxAmount,
    durationDays: cycle.durationDays,
    billingCycle: billingCycle in plan.pricing ? billingCycle : "yearly",
    currency: plan.currency,
  };
}

function plansForApi() {
  return Object.values(VERIFICATION_PLANS).map((plan) => ({
    type: plan.type,
    label: plan.label,
    description: plan.description,
    badge: plan.badge,
    currency: plan.currency,
    features: plan.features,
    pricing: plan.pricing,
    amount: plan.pricing.yearly.amount,
    maxAmount: plan.pricing.yearly.maxAmount,
    durationDays: plan.pricing.yearly.durationDays,
  }));
}

module.exports = {
  VERIFICATION_PLANS,
  resolvePlanPricing,
  plansForApi,
};
