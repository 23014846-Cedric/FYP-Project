// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) return res.redirect('/login');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // decoded should already contain: id, email, role, name (from your JWT)
    req.user = decoded;
    res.locals.user = decoded;   // <-- this makes `user` available in EJS

    next();
  } catch (err) {
    return res.redirect('/login');
  }
};
