const express = require("express");
const mongoose = require("mongoose");
const { GridFSBucket, ObjectId } = require("mongodb");
const multer = require("multer");
const awsS3 = require("../services/awsS3.service");
const { requireAuth } = require("../middleware/auth.middleware");

function getBucket() {
  return new GridFSBucket(mongoose.connection.db, { bucketName: "media" });
}

module.exports = () => {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 35 * 1024 * 1024 },
  });

  function extForContentType(contentType) {
    const ct = (contentType || "").toLowerCase();
    if (ct.includes("image/jpeg")) return "jpg";
    if (ct.includes("image/png")) return "png";
    if (ct.includes("image/webp")) return "webp";
    if (ct.includes("image/gif")) return "gif";
    if (ct.includes("video/mp4")) return "mp4";
    if (ct.includes("video/webm")) return "webm";
    if (ct.includes("video/quicktime")) return "mov";
    return ct.startsWith("video/") ? "mp4" : "jpg";
  }

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

  /**
   * Direct upload into Mongo GridFS (no AWS).
   * Multipart: file + optional folder. Returns { url: "/api/media/{id}.{ext}" }.
   */
  router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file || !file.buffer) {
        return res.status(400).json({ message: "file is required" });
      }

      const folder = (req.body?.folder || "broadcast/uploads").toString();
      const ext = extForContentType(file.mimetype);

      const _id = new ObjectId();
      const bucket = getBucket();
      const stream = bucket.openUploadStream(`${folder}/media.${ext}`, {
        _id,
        contentType: file.mimetype,
        metadata: {
          folder,
          originalName: file.originalname,
        },
      });

      stream.end(file.buffer);

      stream.on("error", (err) => {
        console.error("media upload:", err);
        res.status(500).json({ message: "Upload failed" });
      });

      stream.on("finish", () => {
        res.status(200).json({ url: `/api/media/${_id.toString()}.${ext}` });
      });
    } catch (err) {
      console.error("media upload:", err);
      res.status(500).json({ message: "Upload failed" });
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
