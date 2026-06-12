const express = require("express");
const mongoose = require("mongoose");
const { GridFSBucket, ObjectId } = require("mongodb");
const awsS3 = require("../services/awsS3.service");
const { requireAuth } = require("../middleware/auth.middleware");

function getBucket() {
  return new GridFSBucket(mongoose.connection.db, { bucketName: "media" });
}

module.exports = () => {
  const router = express.Router();

  /**
   * Pre-signed S3 PUT URLs for direct client upload (images, videos, previews, posters).
   * Body: { folder?, files: [{ contentType, variant?: "original"|"preview"|"poster", ext? }] }
   */
  router.post("/presign", requireAuth, async (req, res) => {
    try {
      if (!awsS3.isConfigured()) {
        return res.status(503).json({
          message:
            "AWS S3 is not configured. Set AWS_S3_BUCKET, AWS_REGION, and credentials on the server.",
        });
      }
      const { folder, files } = req.body || {};
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ message: "files array is required" });
      }
      if (files.length > 6) {
        return res.status(400).json({ message: "Too many files in one presign request" });
      }
      const payload = await awsS3.createPresignedUploads({ folder, files });
      return res.status(200).json(payload);
    } catch (err) {
      console.error("media presign:", err.message);
      return res.status(500).json({ message: "Could not create upload URLs" });
    }
  });

  /** Legacy GridFS media — keep serving old /api/media/{id} URLs. */
  router.get("/:filename", async (req, res) => {
    try {
      const raw = req.params.filename;
      const idStr = raw.replace(/\.(jpe?g|png|gif|webp|mp4|mov|webm)$/i, "");

      if (!ObjectId.isValid(idStr)) {
        return res.status(400).send("Invalid media id");
      }

      const _id = new ObjectId(idStr);
      const bucket = getBucket();
      const files = await bucket.find({ _id }).toArray();

      if (!files.length) {
        return res.status(404).send("Not found");
      }

      const file = files[0];
      res.set(
        "Content-Type",
        file.contentType ||
          (raw.endsWith(".mp4") ? "video/mp4" : "image/jpeg"),
      );
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.set("Accept-Ranges", "bytes");
      res.set("Access-Control-Allow-Origin", "*");

      bucket.openDownloadStream(_id).pipe(res);
    } catch (err) {
      console.error("media stream:", err);
      res.status(500).send("Error");
    }
  });

  return router;
};
