async function classifySafeSearch(_mediaUrl) {
  // Phase 2: wire Google Cloud Vision SafeSearch here. The moderation pipeline
  // calls this wrapper so image/video risk can be added without route changes.
  return {
    adult: "UNKNOWN",
    violence: "UNKNOWN",
    racy: "UNKNOWN",
    medical: "UNKNOWN",
    spoof: "UNKNOWN",
    riskScore: 0,
  };
}

module.exports = {
  classifySafeSearch,
};
