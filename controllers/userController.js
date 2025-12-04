// controllers/userController.js

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

const SALT = 10;

// Move this to .env later: process.env.ADMIN_SECRET
const ADMIN_SECRET = process.env.ADMIN_SECRET || "MY_SUPER_SECRET_ADMIN_CODE";

// Helper to create JWT (for login later)
const createToken = (user) =>
  jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
    process.env.JWT_SECRET || "DEV_JWT_SECRET",
    { expiresIn: "1d" }
  );

// ========== SIGNUP ==========

// GET: show signup page
exports.showSignupForm = (req, res) => {
  res.render("signup", {
    errors: [],
    formData: {}, // so we can repopulate on error
  });
};

// POST: handle signup
exports.signup = async (req, res) => {
  try {
    const { name, email, password, role, adminCode } = req.body;

    const formData = { name, email, role }; // for repopulating form
    const errors = [];

    // Basic validation
    if (!name || !email || !password) {
      errors.push("Name, email and password are required");
    }

    // Check email already used
    const existing = await User.findOne({ email });
    if (existing) {
      errors.push("Email already taken");
    }

    // If user chose admin, verify adminCode
    if (role === "admin") {
      if (!adminCode) {
        errors.push("Admin access code is required for admin role");
      } else if (adminCode !== ADMIN_SECRET) {
        errors.push("Invalid admin access code");
      }
    }

    // If user chose compliance, verify complianceCode
    if (role === "compliance") {
      if (!req.body.complianceCode) {
        errors.push("Compliance access code is required for compliance role");
      } else if (req.body.complianceCode !== "compliance") {
        errors.push("Invalid compliance access code");
      }
    }


    if (errors.length > 0) {
      return res.render("signup", { errors, formData });
    }

    const passwordHash = await bcrypt.hash(password, SALT);

    await User.create({
      name,
      email,
      passwordHash,
      role:
      role === "admin"
        ? "admin"
        : role === "compliance"
        ? "compliance"
        : role === "operations"
        ? "operations"
        : "user",
    });

    res.redirect("/login");
  } catch (err) {
    console.error(err);
    res.render("signup", {
      errors: ["Something went wrong"],
      formData: req.body,
    });
  }
};

// ========== SIGNIN / LOGIN ==========

// POST: handle sign in / login
exports.signin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const errors = [];

    if (!email || !password) {
      errors.push("Email and password are required");
      return res.render("login", { errors });
    }

    const user = await User.findOne({ email });
    if (!user) {
      errors.push("Invalid email or password");
      return res.render("login", { errors });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      errors.push("Invalid email or password");
      return res.render("login", { errors });
    }

    const token = createToken(user);

    // Store token in cookie (adjust name/options as needed)
    res.cookie("token", token, {
      httpOnly: true,
      // secure: true, // enable in production + HTTPS
      maxAge: 24 * 60 * 60 * 1000,
    });


    await AuditLog.create({
      username: user.name,
      user_id: user._id,
      action_type: "LOGIN",
      entity_type: "User",
      entity_id: user._id,
      source: "Web",
      remarks: "User logged in"
    });

    res.redirect("/dashboard"); // change to your dashboard route

    if (user.role === "compliance") {
      return res.redirect("/auditLog");
    }

    if (user.role === "admin") {
      return res.redirect("/dashboard");
    }

    // default user behavior
    return res.redirect("/dashboard");
    
 // change to your dashboard route

  } catch (err) {
    console.error(err);
    res.render("login", { errors: ["Something went wrong during login"] });
  }
};

// ========== LOGOUT ==========

// GET: handle logout
exports.logout = async(req, res) => {
  res.clearCookie("token");
  if (req.user) {
    await AuditLog.create({
      username: req.user.name,
      user_id: req.user._id,
      action_type: "LOGOUT",
      entity_type: "User",
      entity_id: req.user._id,
      source: "Web",
      remarks: "User logged out"
    });
  }
  res.redirect("/login");
};

// ========== UPDATE USER ROLE (Admin Only) ==========
exports.updateUserRole = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).send("Access denied. Admins only.");
    }

    const { userId, newRole } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).send("User not found");
    }

    const oldRole = user.role;
    user.role = newRole;
    await user.save();

    // ADDED: Log role update
    await AuditLog.create({
      username: req.user.name,
      user_id: req.user._id,
      action_type: "ROLE_UPDATE",
      entity_type: "User",
      entity_id: user._id,
      field: "role",
      old_value: oldRole,
      new_value: newRole,
      source: "Web",
      remarks: "Admin changed user role"
    });

    res.redirect("/admin/users");
  } catch (err) {
    console.error("Error updating role:", err);
    res.status(500).send("Error updating role");
  }
};
// (no module.exports override – we only use exports.<name>)
