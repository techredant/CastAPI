const { verifyToken } = require("@clerk/backend");

function getClerkSecretKey() {
  return (process.env.CLERK_SECRET_KEY || "").trim();
}

/**
 * Verify a Clerk session JWT from mobile / web / Kotlin native.
 * @returns {{ userId: string, email?: string }}
 */
async function verifyClerkBearerToken(token) {
  const secretKey = getClerkSecretKey();
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is not configured");
  }
  const payload = await verifyToken(token, { secretKey });
  const userId = payload.sub;
  if (!userId) {
    throw new Error("Invalid Clerk token");
  }
  return {
    userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

module.exports = {
  verifyClerkBearerToken,
};
