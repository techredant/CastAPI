const { OAuth2Client } = require("google-auth-library");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

let client = null;

function getClient() {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }
  if (!client) {
    client = new OAuth2Client(GOOGLE_CLIENT_ID);
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
  const ticket = await getClient().verifyIdToken({
    idToken: idToken.trim(),
    audience: GOOGLE_CLIENT_ID,
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
