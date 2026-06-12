/**
 * Verifies IAM can presign and PUT to S3. Run from backend/: node scripts/verify-s3-presign.cjs
 */
require("dotenv").config();
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

async function main() {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  const region = process.env.AWS_REGION?.trim();
  const key = `broadcast/_healthcheck/${Date.now()}.txt`;

  if (!bucket || !region) {
    console.error("Set AWS_S3_BUCKET and AWS_REGION in backend/.env");
    process.exit(1);
  }

  const client = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
    },
  });

  const contentType = "text/plain";
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(client, command, { expiresIn: 300 });
  const body = "broadcast-s3-healthcheck";

  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("PUT failed:", res.status, text.slice(0, 500));
    console.error("\nFix: attach backend/aws/iam-media-backend-policy.json to IAM user media-backend");
    process.exit(1);
  }

  console.log("OK — presigned PUT succeeded");
  console.log("Key:", key);
  console.log("Bucket:", bucket);
  console.log("Region:", region);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
