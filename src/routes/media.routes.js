const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const { GridFSBucket, ObjectId } = require("mongodb");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function getBucket() {
  return new GridFSBucket(mongoose.connection.db, { bucketName: "media" });
}

const DEFAULT_FOLDER = "broadcast/uploads";

function sanitizeFolder(value) {
  if (typeof value !== "string") return DEFAULT_FOLDER;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_FOLDER;
  if (!/^[a-zA-Z0-9/_-]{1,120}$/.test(trimmed)) return DEFAULT_FOLDER;
  return trimmed;
}

function mediaTypeFromMime(mimeType) {
  return mimeType?.startsWith("video/") ? "video" : "image";
}

function extensionForMime(mimeType, type) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "video/quicktime") return ".mov";
  if (mimeType === "video/webm") return ".webm";
  return type === "video" ? ".mp4" : ".jpg";
}

function uploadToGridFS(buffer, { filename, contentType, folder }) {
  const bucket = getBucket();
  const uploadStream = bucket.openUploadStream(filename, {
    contentType,
    metadata: { folder, uploadedAt: new Date() },
  });

  return new Promise((resolve, reject) => {
    uploadStream.on("error", reject);
    uploadStream.on("finish", () => resolve(uploadStream.id));
    uploadStream.end(buffer);
  });
}

module.exports = () => {
  const router = express.Router();

  /**
   * Accept compressed media from web/mobile clients and store in GridFS.
   * Returns a stable /api/media/<id> URL served by the GET route below.
   */
  router.post("/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ message: "No file provided" });
      }

      const folder = sanitizeFolder(req.body?.folder ?? req.query?.folder);
      const contentType = req.file.mimetype || "application/octet-stream";
      const type = mediaTypeFromMime(contentType);
      const ext = extensionForMime(contentType, type);
      const filename =
        typeof req.file.originalname === "string" && req.file.originalname.trim()
          ? req.file.originalname.trim()
          : `upload${ext}`;

      const fileId = await uploadToGridFS(req.file.buffer, {
        filename,
        contentType,
        folder,
      });

      const url = `/api/media/${fileId.toString()}${ext}`;
      return res.status(201).json({ url, type, id: fileId.toString() });
    } catch (err) {
      console.error("media upload:", err);
      return res.status(500).json({ message: "Upload failed" });
    }
  });

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
