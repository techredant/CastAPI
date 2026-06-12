/**
 * Shows which IAM principal your .env keys use, and tests direct S3 PutObject.
 * Run: node scripts/diagnose-aws-credentials.cjs
 */
require("dotenv").config();
const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

async function main() {
  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    console.error("Missing AWS_* vars in backend/.env");
    process.exit(1);
  }

  const credentials = { accessKeyId, secretAccessKey };
  const sts = new STSClient({ region, credentials });

  console.log("--- Who am I? (from .env keys) ---");
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  console.log("Account:", identity.Account);
  console.log("ARN:    ", identity.Arn);
  console.log("UserId: ", identity.UserId);
  console.log();

  const expected = "arn:aws:iam::101551113706:user/media-backend";
  if (identity.Arn !== expected) {
    console.warn("WARNING: Expected", expected);
    console.warn("           Your policy must be on THIS user, not only on media-backend.\n");
  } else {
    console.log("OK: Keys belong to media-backend.\n");
  }

  const key = `broadcast/_healthcheck/direct-${Date.now()}.txt`;
  const s3 = new S3Client({ region, credentials });

  console.log("--- Direct PutObject (SDK, not presigned) ---");
  console.log("Bucket:", bucket);
  console.log("Key:   ", key);
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: "direct-put-test",
        ContentType: "text/plain",
      }),
    );
    console.log("SUCCESS: Direct PutObject worked — IAM policy is attached correctly.");
    console.log("If presign still fails, the issue is presigned URL headers (rare).\n");
  } catch (err) {
    console.error("FAILED:", err.name, err.message);
    console.log();
    console.log("--- What you are missing ---");
    console.log("1. IAM → Users →", identity.Arn.split("/").pop());
    console.log("   → Permissions tab must list a policy with s3:PutObject");
    console.log("   → on arn:aws:s3:::" + bucket + "/*");
    console.log();
    console.log("2. Policy must be on the USER (inline or managed),");
    console.log("   NOT only on the S3 bucket (bucket policy needs Principal).");
    console.log();
    console.log("3. Check Permissions boundary on the user (must not deny S3).");
    console.log();
    console.log("4. If bucket uses KMS encryption, add kms:GenerateDataKey on that key.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
