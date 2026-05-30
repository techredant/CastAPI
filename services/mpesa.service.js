const axios = require("axios");

const DARAJA_BASE =
  process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

const DEFAULT_API_BASE =
  process.env.API_PUBLIC_URL ||
  process.env.MPESA_API_BASE_URL ||
  "https://cast-api-zeta.vercel.app";

function getDefaultCallbackUrl() {
  return (
    process.env.MPESA_CALLBACK_URL ||
    `${DEFAULT_API_BASE.replace(/\/$/, "")}/api/mpesa/callback`
  );
}

function formatDarajaError(err) {
  const data = err.response?.data;
  if (data?.errorCode === "500.001.1001") {
    return (
      "M-Pesa STK passkey or shortcode is wrong. " +
      "Use the Lipa Na M-Pesa Online passkey from developer.safaricom.co.ke " +
      "(sandbox: shortcode 174379 + portal passkey, not the old repeated placeholder)."
    );
  }
  if (data?.errorMessage) return data.errorMessage;
  if (data?.error) {
    return typeof data.error === "string" ? data.error : JSON.stringify(data.error);
  }
  if (Array.isArray(data?.errors) && data.errors[0]) {
    return String(data.errors[0]);
  }
  return err.message || "M-Pesa request failed";
}

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const key = (process.env.MPESA_CONSUMER_KEY || "").trim();
  const secret = (process.env.MPESA_CONSUMER_SECRET || "").trim();

  if (!key || !secret) {
    throw new Error("M-Pesa credentials not configured");
  }

  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  let res;
  try {
    res = await axios.get(
      `${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
  } catch (err) {
    const msg = formatDarajaError(err);
    if (/wrong credentials|invalid credentials|unauthorized/i.test(msg)) {
      throw new Error(
        "M-Pesa OAuth failed: wrong Consumer Key or Consumer Secret. " +
          "Use sandbox keys from developer.safaricom.co.ke and sync them to Vercel env vars.",
      );
    }
    throw new Error(msg);
  }

  cachedToken = res.data.access_token;
  tokenExpiresAt = now + (res.data.expires_in || 3599) * 1000;
  return cachedToken;
}

const INVALID_PASSKEY_HINT =
  "bfb279f9aa9bdbcf158e97ddf5e97ddf5e97ddf5e97ddf5e97ddf5e97ddf5e";

function validatePasskeyConfig() {
  const passkey = (process.env.MPESA_PASSKEY || "").trim();
  if (!passkey) {
    throw new Error("MPESA_PASSKEY is not set");
  }
  if (passkey === INVALID_PASSKEY_HINT || passkey.length < 40) {
    throw new Error(
      "MPESA_PASSKEY is invalid. Copy the Lipa Na M-Pesa Online passkey from developer.safaricom.co.ke",
    );
  }
}

/** Verify Daraja OAuth + passkey config (for health checks). */
async function verifyMpesaCredentials() {
  const env =
    process.env.MPESA_ENV === "production" ? "production" : "sandbox";
  try {
    validatePasskeyConfig();
    await getAccessToken();
    return {
      ok: true,
      environment: env,
      shortcode: process.env.MPESA_SHORTCODE || null,
      callbackUrl: getDefaultCallbackUrl(),
    };
  } catch (err) {
    return { ok: false, environment: env, message: err.message };
  }
}

/** Full STK test (manual script only — sends sandbox prompt). */
async function verifyMpesaStkPush() {
  validatePasskeyConfig();
  await getAccessToken();
  return initiateStkPush({
    phoneNumber: "254708374149",
    amount: 1,
    accountReference: "VERIFY",
    description: "Verify",
  });
}

function buildPassword() {
  const shortcode = (process.env.MPESA_SHORTCODE || "").trim();
  const passkey = (process.env.MPESA_PASSKEY || "").trim();
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);

  const password = Buffer.from(shortcode + passkey + timestamp).toString(
    "base64",
  );

  return { password, timestamp };
}

function normalizePhone(phone) {
  let p = String(phone).replace(/\D/g, "");
  if (p.startsWith("0")) p = `254${p.slice(1)}`;
  if (p.startsWith("254")) return p;
  if (p.length === 9) return `254${p}`;
  return p;
}

/**
 * Initiate STK Push (Lipa Na M-Pesa Online)
 */
async function initiateStkPush({
  phoneNumber,
  amount,
  accountReference,
  description,
  callbackUrl,
}) {
  if (process.env.MPESA_MOCK === "true") {
    return {
      mock: true,
      MerchantRequestID: `MOCK-MR-${Date.now()}`,
      CheckoutRequestID: `MOCK-CR-${Date.now()}`,
      ResponseCode: "0",
      ResponseDescription: "Success. Request accepted for processing",
      CustomerMessage: "Mock payment — complete in app",
    };
  }

  const normalized = normalizePhone(phoneNumber);
  if (!normalized || normalized.length < 12) {
    throw new Error("Invalid M-Pesa phone number");
  }

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    throw new Error(formatDarajaError(err));
  }

  const { password, timestamp } = buildPassword();

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType:
      process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
    Amount: Math.ceil(amount),
    PartyA: normalized,
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: normalized,
    CallBackURL: callbackUrl || getDefaultCallbackUrl(),
    AccountReference: String(accountReference || "PAY").slice(0, 12),
    TransactionDesc: (description || "Payment").slice(0, 13),
  };

  try {
    const res = await axios.post(
      `${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const data = res.data;
    if (data.ResponseCode && data.ResponseCode !== "0") {
      throw new Error(
        data.ResponseDescription || data.CustomerMessage || "STK push rejected",
      );
    }
    return data;
  } catch (err) {
    if (err.message && !err.response) throw err;
    throw new Error(formatDarajaError(err));
  }
}

/** STK still processing — must NOT treat as failed/cancelled. */
const STK_QUERY_PENDING_CODES = new Set(["4999"]);

/** Definitive failure codes from Daraja stkpushquery (production). */
const STK_QUERY_FAILED_CODES = new Set([
  "1032", // cancelled by user
  "1", // insufficient balance
  "2001", // wrong PIN
  "2029", // cancelled
  "8006", // rejected
]);

function isSandboxMpesa() {
  return String(process.env.MPESA_ENV || "sandbox").toLowerCase() !== "production";
}

/** Sandbox: no PIN on device → Daraja often returns 1037; auto-mark paid after grace period. */
function sandboxAutoCompleteEnabled() {
  if (process.env.MPESA_MOCK === "true") return false;
  if (process.env.MPESA_SANDBOX_AUTO_COMPLETE === "false") return false;
  return isSandboxMpesa();
}

function paymentAgeMs(doc) {
  const t = doc?.createdAt ? new Date(doc.createdAt).getTime() : 0;
  return t ? Date.now() - t : 0;
}

/**
 * After STK was sent, sandbox test payments can be auto-completed (no handset prompt).
 * @param {number} minAgeMs — wait before auto-complete so real callbacks can win
 */
function shouldSandboxAutoComplete(doc, minAgeMs = 15000) {
  return sandboxAutoCompleteEnabled() && paymentAgeMs(doc) >= minAgeMs;
}

/**
 * Classify stkpushquery response. Non-zero codes like 4999 mean "still processing".
 * @returns {"completed"|"pending"|"failed"}
 */
function classifyStkQueryResult(queryResponse) {
  if (!queryResponse) return "pending";
  const code = String(
    queryResponse.ResultCode ?? queryResponse.resultCode ?? "",
  ).trim();
  if (code === "0") return "completed";
  if (!code || STK_QUERY_PENDING_CODES.has(code)) return "pending";
  // Sandbox: 1037 = timeout because test line has no PIN UI on the device
  if (code === "1037" && isSandboxMpesa()) return "pending";
  if (STK_QUERY_FAILED_CODES.has(code)) return "failed";
  if (code === "1037") return "failed";
  return "pending";
}

/**
 * Query STK transaction status
 */
async function queryStkPush(checkoutRequestId) {
  if (process.env.MPESA_MOCK === "true") {
    return {
      ResultCode: "0",
      ResultDesc: "The service request is processed successfully.",
    };
  }

  const token = await getAccessToken();
  const { password, timestamp } = buildPassword();

  const res = await axios.post(
    `${DARAJA_BASE}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } },
  );

  return res.data;
}

module.exports = {
  initiateStkPush,
  queryStkPush,
  classifyStkQueryResult,
  isSandboxMpesa,
  sandboxAutoCompleteEnabled,
  shouldSandboxAutoComplete,
  normalizePhone,
  getDefaultCallbackUrl,
  verifyMpesaCredentials,
  verifyMpesaStkPush,
};
