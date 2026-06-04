const { verifyAppToken } = require("../services/jwt.service");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return res.status(401).json({ message: "Authorization required" });
  }
  try {
    const decoded = verifyAppToken(match[1]);
    req.userId = decoded.sub;
    req.authEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({
      message: err.name === "TokenExpiredError" ? "Token expired" : "Invalid token",
    });
  }
}

module.exports = {
  requireAuth,
};
