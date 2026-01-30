// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) return res.redirect('/login');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // decoded should already contain: id, email, role, name (from your JWT)
    req.user = decoded;
    res.locals.user = decoded;   // <-- this makes `user` available in EJS

    // Debug (optional): see who is logged in
    // console.log("Decoded user:", decoded);

    next();
  } catch (err) {
    return res.redirect('/login');
  }
};

// ✅ Helper for role-based routes
authMiddleware.requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect('/login');
    }

    if (req.user.role !== role) {
      return res.status(403).send(`Access denied. ${role} only.`);
    }

    next();
  };
};

module.exports = authMiddleware;
