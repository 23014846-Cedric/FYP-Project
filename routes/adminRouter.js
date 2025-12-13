// routes/adminRouter.js

const express = require("express");
const router = express.Router();

const User = require("../models/User");
const requireRole = require("../middleware/requireRole");

// GET /admin/profile  (list users)
router.get("/profile", requireRole("admin"), async (req, res) => {
  try {
    const users = await User.find().lean();
    res.render("adminProfile", { users, user: req.user });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading admin profile");
  }
});

// POST /admin/users/:id/delete  (delete user)
router.post("/users/:id/delete", requireRole("admin"), async (req, res) => {
  try {
    const targetUserId = req.params.id;

    // Block deleting yourself
    if (req.user && String(req.user.id) === String(targetUserId)) {
      return res.status(400).send("You cannot delete your own account.");
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).send("User not found.");
    }

    // Prevent deleting last admin
    if (targetUser.role === "admin") {
      const adminCount = await User.countDocuments({ role: "admin" });
      if (adminCount <= 1) {
        return res.status(400).send("Cannot delete the last admin.");
      }
    }

    await User.findByIdAndDelete(targetUserId);

    // Optional: add audit logging here
    // await AuditLog.create({...})

    return res.redirect("/admin/profile");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Failed to delete user.");
  }
});

module.exports = router;
