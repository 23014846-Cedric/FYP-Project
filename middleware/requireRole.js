// middleware/requireRole.js
module.exports = function requireRole(allowedRoles = []) {
  if (typeof allowedRoles === "string") {
    allowedRoles = [allowedRoles];
  }

  return (req, res, next) => {
    const user = res.locals.user; // you already set this in app.js

    if (!user) {
      // Not logged in
      return res.redirect("/login");
    }

    if (allowedRoles.length && !allowedRoles.includes(user.role)) {
      // Not enough permission
      return res.status(403).render("error", {
        message: "You are not authorised to view this page."
      });
    }

    next();
  };
};
