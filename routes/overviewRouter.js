// routes/overviewRouter.js (FULL)
// URL: GET /deliveries/overview
const express = require("express");
const router = express.Router();

const CardDelivery = require("../models/CardDelivery");

// Helper to convert _id to id string for your EJS tables
function withId(doc) {
  return { ...doc, id: doc._id.toString() };
}

router.get("/overview", async (req, res) => {
  try {
    // If you want ALL records regardless of record_type, remove record_type filters below.
    // I’m splitting by record_type so each column is clean.

    const [deliveries, dispatches, reports, rts] = await Promise.all([
      CardDelivery.find({ record_type: "card" }).sort({ updated_at: -1 }).lean(),
      CardDelivery.find({ record_type: "dispatch" }).sort({ imported_at: -1, created_at: -1 }).lean(),
      CardDelivery.find({ record_type: "progressive" }).sort({ imported_at: -1, created_at: -1 }).lean(),
      CardDelivery.find({ record_type: "rts" }).sort({ updated_at: -1 }).lean(),
    ]);

    return res.render("deliveries/overview", {
      user: req.user,
      deliveries: deliveries.map(withId),
      dispatches: dispatches.map(withId),
      reports: reports.map(withId),
      rts: rts.map(withId),
      counts: {
        deliveries: deliveries.length,
        dispatches: dispatches.length,
        reports: reports.length,
        rts: rts.length,
      },
    });
  } catch (err) {
    console.error("Error loading deliveries overview:", err);
    return res.status(500).send("Error loading deliveries overview");
  }
});

module.exports = router;
