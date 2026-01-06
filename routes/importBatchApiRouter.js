// routes/importBatchApiRouter.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const CardDelivery = require("../models/CardDelivery");

// helper: last 4
function last4(card) {
  if (!card) return "****";
  const clean = String(card).replace(/\s+/g, "");
  return clean.slice(-4);
}

router.get("/api/import-batch/:batchId", authMiddleware, async (req, res) => {
  try {
    const { batchId } = req.params;

    const role = req.user?.role;
    const allowed = ["admin", "operations", "compliance"];
    if (!allowed.includes(role)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    let limit = parseInt(req.query.limit || "50", 10);
    if (Number.isNaN(limit) || limit < 1) limit = 50;
    limit = Math.min(limit, 200);

    const deliveries = await CardDelivery.find({ import_batch_id: batchId })
      .sort({ imported_at: -1 })
      .limit(limit)
      .lean();

    // ✅ Mask for non-admin/ops if you want (recommended)
    const canReveal = ["admin", "operations"].includes(role);

    const safe = deliveries.map((d) => ({
      card_number: canReveal ? d.card_number : `**** **** **** ${last4(d.card_number)}`,
      recipient_name: d.recipient_name,
      address: canReveal ? d.address : (d.address ? `${String(d.address).slice(0, 18)}…` : "-"),
      courier: d.courier || "-",
      status: d.status || "-",
      imported_at: d.imported_at || null,
    }));

    return res.json({ ok: true, deliveries: safe });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
