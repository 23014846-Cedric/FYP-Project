// routes/adminRouter.js

const express = require("express");
const router = express.Router();

const User = require("../models/User");

// USE THE CORRECT ROLE MIDDLEWARE
// (this is the file you showed me earlier)
const requireRole = require("../middleware/requireRole");

// GET /admin/profile
// app.js mounts this router at /admin, so final URL = /admin/profile
router.get(
  "/profile",
  requireRole("admin"),
  async (req, res) => {
    try {
      const users = await User.find().lean();
      res.render("adminProfile", { users, user: req.user });
    } catch (err) {
      console.error(err);
      res.status(500).send("Error loading admin profile");
    }
  }
);

module.exports = router;

