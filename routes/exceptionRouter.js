const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const CardDelivery = require("../models/CardDelivery");

// GET /exceptions
// Show everything that is NOT Delivered
router.get("/", async (req, res) => {
  try {
    const exceptions = await CardDelivery.find({
      status: { $ne: "Delivered" },
    })
      .sort({ updated_at: -1, created_at: -1 })
      .lean();

    return res.render("exceptions", {
      exceptions,
      message: null,
      error: null,
    });
  } catch (err) {
    console.error("Error loading exceptions:", err);
    return res.render("exceptions", {
      exceptions: [],
      message: null,
      error: "Failed to load exceptions.",
    });
  }
});

// GET /exceptions/:id/review
router.get("/:id/review", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.redirect("/exceptions");

    const delivery = await CardDelivery.findById(req.params.id).lean();
    if (!delivery) return res.redirect("/exceptions");

    return res.render("reviewForm", { delivery, error: null });
  } catch (err) {
    console.error("Error loading review page:", err);
    return res.redirect("/exceptions");
  }
});

// POST /exceptions/:id/update
router.post("/:id/update", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.redirect("/exceptions");

    // Build update using your schema field names
    const update = {
      customer: req.body.customer?.trim(),
      vendor: req.body.vendor?.trim(),

      recipient_name: req.body.recipient?.trim(),
      address: req.body.address?.trim(),
      courier: req.body.courier?.trim(),

      // if your schema uses tracking_number, keep it consistent:
      tracking_number: req.body.trackingNumber?.trim(),

      status: req.body.status,
      notes: req.body.notes || "",
      updated_at: new Date(),
    };

    // Only set expected_date if you actually have it in schema
    if (req.body.expectedDate) {
      update.expected_date = new Date(req.body.expectedDate);
    }

    await CardDelivery.findByIdAndUpdate(req.params.id, update, { runValidators: true });

    return res.redirect("/exceptions");
  } catch (err) {
    console.error("Update error:", err);

    const delivery = await CardDelivery.findById(req.params.id).lean();
    return res.render("reviewForm", {
      delivery,
      error: "Failed to update delivery. Please check your inputs.",
    });
  }
});

module.exports = router;
