const { OAuth2Client } = require("google-auth-library");

/** Web client ID — must match client GOOGLE_WEB_CLIENT_ID (ID token `aud`). */
const GOOGLE_WEB_CLIENT_ID = (process.env.GOOGLE_WEB_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();

let client;

function getAudiences() {
  return [...new Set([GOOGLE_WEB_CLIENT_ID, GOOGLE_CLIENT_ID].filter(Boolean))];
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

async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("Missing Google ID token");
  }

  const audiences = getAudiences();
  const ticket = await getOAuthClient().verifyIdToken({
    idToken: idToken.trim(),
    audience: audiences.length === 1 ? audiences[0] : audiences,
  });

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload?.email) {
    throw new Error("Google token missing required profile fields");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.email_verified,
    name: payload.name || "",
    given_name: payload.given_name || "",
    family_name: payload.family_name || "",
    picture: payload.picture || "",
  };
}

module.exports = {
  verifyGoogleIdToken,
};
