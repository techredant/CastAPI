const { OAuth2Client } = require("google-auth-library");

/** Web client ID — must match Kotlin GOOGLE_WEB_CLIENT_ID (ID token `aud`). */
const GOOGLE_WEB_CLIENT_ID = (process.env.GOOGLE_WEB_CLIENT_ID || "").trim();
/** Legacy name; use the Web OAuth client ID here (not the Android client). */
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();

let client = null;

function getGoogleAudiences() {
  return [...new Set([GOOGLE_WEB_CLIENT_ID, GOOGLE_CLIENT_ID].filter(Boolean))];
}

function getClient() {
  const audiences = getGoogleAudiences();
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

/**
 * @param {string} idToken
 * @returns {Promise<{ sub: string, email: string, name?: string, picture?: string, given_name?: string, family_name?: string }>}
 */
async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("Missing Google ID token");
  }
  const audiences = getGoogleAudiences();
  const ticket = await getClient().verifyIdToken({
    idToken: idToken.trim(),
    audience: audiences.length === 1 ? audiences[0] : audiences,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub) {
    throw new Error("Invalid Google token payload");
  }
  const email = (payload.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Google account has no email");
  }
  return {
    sub: payload.sub,
    email,
    name: payload.name,
    picture: payload.picture,
    given_name: payload.given_name,
    family_name: payload.family_name,
  };
}

module.exports = {
  verifyGoogleIdToken,
};
