const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const DEFAULT_FOLDER = "broadcast/uploads";
const PRESIGN_TTL_SECONDS = 15 * 60;

let s3Client;

function isConfigured() {
  return Boolean(
    process.env.AWS_S3_BUCKET?.trim() &&
      process.env.AWS_REGION?.trim() &&
      process.env.AWS_ACCESS_KEY_ID?.trim() &&
      process.env.AWS_SECRET_ACCESS_KEY?.trim(),
  );
}

function getClient() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION.trim(),
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
      },
    });
  }
  return s3Client;
}

function cloudFrontBase() {
  const cf = process.env.CLOUDFRONT_URL?.trim();
  if (cf) return cf.replace(/\/$/, "");
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  const region = process.env.AWS_REGION?.trim();
  if (!bucket || !region) return "";
  return `https://${bucket}.s3.${region}.amazonaws.com`;
}

function sanitizeFolder(value) {
  if (typeof value !== "string") return DEFAULT_FOLDER;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_FOLDER;
  if (!/^[a-zA-Z0-9/_-]{1,120}$/.test(trimmed)) return DEFAULT_FOLDER;
  return trimmed;
}

function extensionForContentType(contentType) {
  const mime = (contentType || "").toLowerCase();
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  if (mime === "video/quicktime") return "mov";
  if (mime === "video/webm") return "webm";
  if (mime.startsWith("video/")) return "mp4";
  return "jpg";
}

function buildObjectKey(folder, { variant = "original", contentType, ext }) {
  const id = crypto.randomUUID();
  const suffix = ext || extensionForContentType(contentType);
  const safeVariant = ["original", "preview", "poster"].includes(variant)
    ? variant
    : "original";
  return `${folder}/${id}/${safeVariant}.${suffix}`;
}

function publicUrlForKey(key) {
  const base = cloudFrontBase();
  if (!base) return `/${key}`;
  return `${base}/${key}`;
}

/**
 * @param {{ folder?: string, files: Array<{ contentType: string, variant?: string, ext?: string }> }} input
 */
async function createPresignedUploads({ folder, files }) {
  if (!isConfigured()) {
    throw new Error("AWS S3 is not configured");
  }
  const bucket = process.env.AWS_S3_BUCKET.trim();
  const safeFolder = sanitizeFolder(folder);
  const client = getClient();

  const items = await Promise.all(
    (files || []).map(async (file) => {
      const contentType = file.contentType || "application/octet-stream";
      const key = buildObjectKey(safeFolder, {
        variant: file.variant,
        contentType,
        ext: file.ext,
      });
      // Only sign Content-Type — client must send the same header on PUT.
      // Cache-Control is set on CloudFront, not required on upload.
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: PRESIGN_TTL_SECONDS,
      });
      return {
        key,
        uploadUrl,
        publicUrl: publicUrlForKey(key),
        contentType,
        variant: file.variant || "original",
        expiresIn: PRESIGN_TTL_SECONDS,
      };
    }),
  );

  const original = items.find((i) => i.variant === "original") || items[0];

  return {
    items,
    url: original?.publicUrl,
    expiresIn: PRESIGN_TTL_SECONDS,
  };
}

module.exports = {
  isConfigured,
  createPresignedUploads,
  publicUrlForKey,
  sanitizeFolder,
  cloudFrontBase,
};
