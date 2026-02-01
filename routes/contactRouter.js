// routes/contactRouter.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const ContactMessage = require("../models/ContactMessage");
const authMiddleware = require("../middleware/authMiddleware");

// ================== CONTACT FORM (ALL ROLES) ================== //

// GET /contact – show form (any logged-in user)
router.get(
  "/",
  authMiddleware,
  (req, res) => {
    res.render("contact", {
      errors: [],
      success: false,
      formData: {}
    });
  }
);

// POST /contact – validate + save (any logged-in user)
router.post(
  "/",
  authMiddleware,
  async (req, res) => {
    const { name, email, company, topic, message } = req.body;
    const errors = [];

    if (!name) errors.push("Full name is required.");
    if (!email) errors.push("Email is required.");
    if (!message) errors.push("Message is required.");

    if (errors.length > 0) {
      return res.render("contact", {
        errors,
        success: false,
        formData: req.body
      });
    }

    try {
      await ContactMessage.create({
        name,
        email,
        company,
        topic,
        message,
        createdByIp: req.ip
      });

      return res.render("contact", {
        errors: [],
        success: true,
        formData: {}
      });
    } catch (err) {
      console.error("CONTACT CREATE ERROR:", err);
      return res.render("contact", {
        errors: ["Something went wrong. Please try again later."],
        success: false,
        formData: req.body
      });
    }
  }
);

// ================== OPERATIONS-ONLY VIEW ================== //

// GET /contact/messages
router.get(
  "/messages",
  authMiddleware,
  authMiddleware.requireRole("operations"),
  async (req, res) => {
    const messages = await ContactMessage.find().sort({ createdAt: -1 }).lean();
    return res.render("contactMessages", { messages });
  }
);

// ================== OPERATIONS ACTIONS ================== //

// POST /contact/messages/:id/toggle
router.post(
  "/messages/:id/toggle",
  authMiddleware,
  authMiddleware.requireRole("operations"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).send("Invalid ID");
      }

      const msg = await ContactMessage.findById(id);
      if (!msg) return res.status(404).send("Message not found");

      // Map Open/Closed to your enum:
      // Open = "new" (or "in_progress"), Closed = "closed"
      msg.status = (msg.status === "closed") ? "new" : "closed";
      await msg.save();

      return res.redirect("/contact/messages");
    } catch (err) {
      console.error("TOGGLE ERROR:", err);
      return res.status(500).send("Server error");
    }
  }
);

// POST /contact/messages/:id/delete
router.post(
  "/messages/:id/delete",
  authMiddleware,
  authMiddleware.requireRole("operations"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).send("Invalid ID");
      }

      console.log("DELETE HIT:", id);

      const deleted = await ContactMessage.findByIdAndDelete(id);
      if (!deleted) return res.status(404).send("Message not found");

      return res.redirect("/contact/messages");
    } catch (err) {
      console.error("DELETE ERROR:", err);
      return res.status(500).send("Server error");
    }
  }
);

module.exports = router;
