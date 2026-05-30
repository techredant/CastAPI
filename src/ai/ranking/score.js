const DEFAULT_WEIGHTS = {
  recency: 0.35,
  engagement: 0.25,
  authorAffinity: 0.18,
  countyMatch: 0.12,
  topicMatch: 0.18,
  riskPenalty: -0.45,
};

function scorePost(features, weights = DEFAULT_WEIGHTS) {
  return Object.entries(DEFAULT_WEIGHTS).reduce((sum, [key, fallback]) => {
    const weight = weights[key] ?? fallback;
    return sum + (features[key] || 0) * weight;
  }, 0);
}

module.exports = {
  DEFAULT_WEIGHTS,
  scorePost,
};
