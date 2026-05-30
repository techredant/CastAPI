/**
 * Verify M-Pesa Daraja OAuth using backend/.env
 * Usage: node scripts/verify-mpesa.cjs
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const {
  verifyMpesaCredentials,
  verifyMpesaStkPush,
} = require("../services/mpesa.service");

async function main() {
  const status = await verifyMpesaCredentials();
  console.log(JSON.stringify(status, null, 2));
  if (!status.ok) process.exit(1);

  console.log("\nTesting STK push (KES 1 to sandbox 254708374149)...");
  const stk = await verifyMpesaStkPush();
  console.log(
    JSON.stringify(
      {
        ok: true,
        responseCode: stk.ResponseCode,
        customerMessage: stk.CustomerMessage,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
