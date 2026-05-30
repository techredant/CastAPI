async function classifyCloudinaryMedia(_publicIdOrUrl) {
  // Placeholder for Cloudinary AI moderation add-ons. Keeping a narrow wrapper
  // avoids binding product routes directly to a vendor-specific response shape.
  return {
    labels: [],
    riskScore: 0,
  };
}

module.exports = {
  classifyCloudinaryMedia,
};
