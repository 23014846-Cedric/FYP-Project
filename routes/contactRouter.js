// routes/contactRouter.js
const express = require("express");
const router = express.Router();
const ContactMessage = require("../models/ContactMessage");

// GET /contact – show form
router.get("/", (req, res) => {
  res.render("contact", {
    errors: [],
    success: false,
    formData: {}
  });
});

// POST /contact – validate + save to DB
router.post("/", async (req, res) => {
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

    // Clear form, show success banner (your EJS already supports this)
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
});

module.exports = router;
