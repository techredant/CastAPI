const { verifyAppToken } = require("../services/jwt.service");

function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || "";
}

async function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: "Authorization required" });
  }

  try {
    const decoded = verifyAppToken(token);
    req.userId = decoded.sub;
    req.authEmail = decoded.email;
    req.authProvider = "google";
    return next();
  } catch (err) {
    const expired = err?.name === "TokenExpiredError";
    return res.status(401).json({
      message: expired ? "Token expired" : "Invalid token",
    });
  }
}

module.exports = {
  requireAuth,
  extractBearerToken,
};
