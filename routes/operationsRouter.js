// routes/operationsRouter.js
const express = require("express");
const router = express.Router();
const ContactMessage = require("../models/ContactMessage");
const requireRole = require("../middleware/requireRole");

// GET /operations/enquiries – list all contact messages
router.get(
  "/enquiries",
  requireRole(["operations", "admin"]),
  async (req, res) => {
    const messages = await ContactMessage.find().sort({ createdAt: -1 });
    res.render("operations/inbox", { messages });
  }
);

// POST /operations/enquiries/:id – update status/notes
router.post(
  "/enquiries/:id",
  requireRole(["operations", "admin"]),
  async (req, res) => {
    const { status, internalNotes } = req.body;
    try {
      const msg = await ContactMessage.findById(req.params.id);
      if (!msg) return res.status(404).send("Not found");

      msg.status = status || msg.status;
      msg.internalNotes = internalNotes || msg.internalNotes;
      msg.handledBy = res.locals.user ? res.locals.user.id : msg.handledBy;

      await msg.save();
      res.redirect("/operations/enquiries");
    } catch (err) {
      console.error(err);
      res.status(500).send("Error updating enquiry");
    }
  }
);

module.exports = router;
