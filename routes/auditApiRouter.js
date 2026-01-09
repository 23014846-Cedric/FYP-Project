// routes/auditApiRouter.js
const express = require("express");
const router = express.Router();

const CardDelivery = require("../models/CardDelivery");
const AuditLog = require("../models/AuditLog");
const authMiddleware = require("../middleware/authMiddleware");
const { addAuditLog } = require("../utils/audit");

// ===============================
// 1) Save anchoring tx into AuditLog
//    Your EJS expects: anchor_tx (not txHash)
// ===============================
router.post("/api/audit/:id/tx", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body;

    if (!txHash) return res.status(400).json({ ok: false, error: "txHash is required" });

    // ✅ Update ONLY anchoring metadata fields
    await AuditLog.updateOne(
      { _id: id },
      {
        $set: {
          anchored: true,
          anchor_tx: txHash,
          anchored_at: new Date(),
        },
      }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    if (res.headersSent) return;
    return res.status(500).json({ ok: false, error: "Failed to update anchor tx" });
  }
});

// ===============================
// 2) Create a demo audit log and return hash
//    FIX: remove the second res.json
// ===============================
router.post("/api/audit/sample", authMiddleware, async (req, res) => {
  try {
    const { actionType = "DEMO_ACTION" } = req.body;

    const log = await addAuditLog(req, {
      action_type: actionType,
      entity_type: "DemoEntity",
      entity_id: "DEMO_ID",
      source: "WIP Demo",
      remarks: "Demo blockchain-anchored audit log",
    });

    return res.json({
      ok: true,
      auditLogId: log._id,
      hash: log.hash,          // ✅ your model uses "hash"
      prev_hash: log.prev_hash,
      actionType: log.action_type,
    });
  } catch (err) {
    console.error(err);
    if (res.headersSent) return;
    return res.status(500).json({ ok: false, error: "Failed to create sample audit log" });
  }
});

// ===============================
// 3) Fetch deliveries by import batch
// ===============================
router.get("/api/import-batch/:batchId", authMiddleware, async (req, res) => {
  try {
    const { batchId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);

    const deliveries = await CardDelivery.find({ import_batch_id: batchId })
      .sort({ imported_at: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, deliveries });
  } catch (err) {
    console.error(err);
    if (res.headersSent) return;
    return res.status(500).json({ ok: false, error: "Failed to load batch deliveries" });
  }
});

module.exports = router;
