// middleware/revealMiddleware.js
const jwt = require("jsonwebtoken");

module.exports = function revealMiddleware(req, res, next) {
  res.locals.canRevealSensitive = false;

  const token = req.cookies?.reveal_token;
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // scope check
    if (decoded.scope === "reveal_sensitive" && decoded.role === "printer") {
      res.locals.canRevealSensitive = true;
    }
  } catch (e) {
    // ignore invalid/expired token
  }

  next();
};
