// routes/contactRouter.js
const express = require("express");
const router = express.Router();
const ContactMessage = require("../models/ContactMessage");
const authMiddleware = require("../middleware/authMiddleware");

// ================== CONTACT FORM (ALL ROLES) ================== //

// GET /contact – show form (any logged-in user)
router.get(
  "/",
  authMiddleware,         // uses your existing auth (checks JWT, sets req.user)
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
        // optionally: createdByUser: req.user.id
      });

      res.render("contact", {
        errors: [],
        success: true,
        formData: {}
      });
    } catch (err) {
      console.error(err);
      res.render("contact", {
        errors: ["Something went wrong. Please try again later."],
        success: false,
        formData: req.body
      });
    }
  }
);

// ================== OPERATIONS-ONLY VIEW ================== //

router.get(
  "/messages",
  authMiddleware,                           // must be logged in
  authMiddleware.requireRole("operations"), // must be operations
  async (req, res) => {
    const messages = await ContactMessage.find().sort({ createdAt: -1 }).lean();
    res.render("contactMessages", { messages });
  }
);


module.exports = router;
