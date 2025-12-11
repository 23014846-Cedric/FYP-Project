// routes/printerRouter.js
const express = require("express");
const router = express.Router();
const CardDelivery = require("../models/CardDelivery");
const requireRole = require("../middleware/requireRole");

// All routes here are guarded by /printer + auth + requireRole('printer') in app.js

// View all cards returned to printer
router.get("/returns", async (req, res) => {
  const deliveries = await CardDelivery.find({
    status: "Returned to Printer"
  }).lean();

  res.render("printer/returns", { deliveries });
});

// Mark as Destroyed or Reprocessing
router.post("/:id/update-status", async (req, res) => {
  const { id } = req.params;
  const { new_status } = req.body;

  const allowed = ["Destroyed", "Reprocessing"];
  if (!allowed.includes(new_status)) {
    return res.status(400).send("Invalid status for printer action");
  }

  await CardDelivery.findByIdAndUpdate(id, {
    status: new_status,
    updated_at: new Date()
  });

  // Optional: log in AuditLog here

  res.redirect("/printer/returns");
});

module.exports = router;
