const { OAuth2Client } = require("google-auth-library");

/** Web client ID — must match client GOOGLE_WEB_CLIENT_ID (ID token `aud`). */
const GOOGLE_WEB_CLIENT_ID = (process.env.GOOGLE_WEB_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_ANDROID_CLIENT_IDS = (process.env.GOOGLE_ANDROID_CLIENT_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

let client;

function getAudiences() {
  return [
    ...new Set(
      [GOOGLE_WEB_CLIENT_ID, GOOGLE_CLIENT_ID, ...GOOGLE_ANDROID_CLIENT_IDS].filter(
        Boolean,
      ),
    ),
  ];
}

function getOAuthClient() {
  const audiences = getAudiences();
  if (!audiences.length) {
    throw new Error(
      "GOOGLE_WEB_CLIENT_ID or GOOGLE_CLIENT_ID is not configured",
    );
  }
  if (!client) {
    client = new OAuth2Client(audiences[0]);
  }
  return client;
}

function formatVerifyError(err) {
  const message = err?.message || "Google sign-in failed";
  if (/audience|recipient|Wrong/i.test(message)) {
    return new Error(
      "Google sign-in could not be verified for this app. " +
        "If you use a work or school account, ask your IT admin to allow third-party Google sign-in for Broadcast.",
    );
  }
  return err instanceof Error ? err : new Error(message);
}

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("Missing Google ID token");
  }

  const audiences = getAudiences();
  const trimmed = idToken.trim();
  let payload;

  try {
    const ticket = await getOAuthClient().verifyIdToken({
      idToken: trimmed,
      audience: audiences.length === 1 ? audiences[0] : audiences,
    });
    payload = ticket.getPayload();
  } catch (primaryErr) {
    try {
      const ticket = await getOAuthClient().verifyIdToken({ idToken: trimmed });
      payload = ticket.getPayload();
      const tokenAud = payload?.aud;
      if (!tokenAud || !audiences.includes(tokenAud)) {
        throw formatVerifyError(primaryErr);
      }
    } catch {
      throw formatVerifyError(primaryErr);
    }
  }

  const email = normalizeEmail(payload?.email);
  if (!payload?.sub) {
    throw new Error("Google token missing user id");
  }
  if (!email) {
    throw new Error(
      "Google did not share your email address. " +
        "Work and school accounts sometimes block this — ask your IT admin to allow email access for Broadcast, or try a personal Gmail account.",
    );
  }

  const isWorkspace = Boolean(payload.hd);
  if (payload.email_verified === false && !isWorkspace) {
    throw new Error("Google email is not verified");
  }

  return {
    sub: payload.sub,
    email,
    email_verified: payload.email_verified,
    hd: payload.hd || "",
    name: payload.name || "",
    given_name: payload.given_name || "",
    family_name: payload.family_name || "",
    picture: payload.picture || "",
  };
}

module.exports = {
  verifyGoogleIdToken,
  normalizeEmail,
};
