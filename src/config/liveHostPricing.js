/** M-Pesa fee to start broadcasting (viewers join free). Audio rooms are excluded in the app. */
const LIVE_HOST_ACCESS = {
  community: {
    id: "community",
    label: "Community live",
    amount: 100,
    currency: "KES",
    description: "Go live in your community feed",
  },
  market: {
    id: "market",
    label: "Market live",
    amount: 150,
    currency: "KES",
    description: "Sell products on a market livestream",
  },
};

/** Host access remains valid this long after payment (ms). */
const HOST_ACCESS_TTL_MS = 4 * 60 * 60 * 1000;

function getHostAccessPlan(streamKind) {
  return LIVE_HOST_ACCESS[streamKind] || null;
}

module.exports = {
  LIVE_HOST_ACCESS,
  HOST_ACCESS_TTL_MS,
  getHostAccessPlan,
};
