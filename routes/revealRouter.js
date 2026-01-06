// routes/revealRouter.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const AuditLog = require("../models/AuditLog");
const { addAuditLog } = require("../utils/audit");

// Printer submits an admin password to temporarily reveal sensitive fields
router.post("/reveal/request", authMiddleware, async (req, res) => {
  try {
    // only printer can request
    if (!req.user || req.user.role !== "printer") {
      return res.status(403).json({ error: "Only printer can request reveal." });
    }

    const { adminPassword } = req.body;
    if (!adminPassword) {
      return res.status(400).json({ error: "Password required." });
    }

    // Find an admin user (you can refine this to a specific admin email)
    const adminUser = await User.findOne({ role: "admin" });
    if (!adminUser) {
      return res.status(500).json({ error: "No admin configured." });
    }

    const ok = await bcrypt.compare(adminPassword, adminUser.passwordHash);
    if (!ok) {
      // Optional: rate-limit / lockout here
      return res.status(401).json({ error: "Invalid password." });
    }

    // Issue short-lived reveal token (e.g., 5 minutes)
    const revealToken = jwt.sign(
      { scope: "reveal_sensitive", role: "printer", userId: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: "5m" }
    );

    res.cookie("reveal_token", revealToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // set true in production https
      maxAge: 5 * 60 * 1000
    });

    // Audit log this sensitive reveal (hashed for blockchain anchoring)
    await addAuditLog(req, {
      action_type: "SENSITIVE_REVEAL_GRANTED",
      entity_type: "DeliveryData",
      entity_id: null, // no specific delivery ID
      source: "Web",
      remarks: "Printer obtained temporary access to full card/address via step-up auth"
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error." });
  }
});

// Optional: end reveal session early
router.post("/reveal/clear", authMiddleware, (req, res) => {
  res.clearCookie("reveal_token");
  return res.json({ ok: true });
});

module.exports = router;
