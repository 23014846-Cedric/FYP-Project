const express = require("express");
const router = express.Router();

const CardDelivery = require("../models/CardDelivery");
const AuditLog = require("../models/AuditLog");
const authMiddleware = require("../middleware/authMiddleware");
const { addAuditLog } = require("../utils/audit");

// Save txHash into an audit log
router.post("/api/audit/:id/tx", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body;

    if (!txHash) return res.status(400).json({ error: "txHash is required" });

    await AuditLog.findByIdAndUpdate(id, { txHash });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update txHash" });
  }
});

// Create a demo audit log and return hash
router.post("/api/audit/sample", authMiddleware, async (req, res) => {
  try {
    const { actionType = "DEMO_ACTION" } = req.body;

    // Create demo audit log using central audit helper (hashed)
    const log = await addAuditLog(req, {
    action_type: actionType,
    entity_type: "DemoEntity",
    entity_id: "DEMO_ID",
    source: "WIP Demo",
    remarks: "Demo blockchain-anchored audit log",
    });
    res.json({
    auditLogId: log._id,
    logHash: log.logHash,
    actionType: log.action_type,
    });

    res.json({ auditLogId: log._id, logHash: log.logHash, actionType: log.action_type });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create sample audit log" });
  }
});

router.get("/api/import-batch/:batchId", authMiddleware, async (req, res) => {
  try {
    const { batchId } = req.params;

    // Optional: limit to avoid rendering huge tables
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);

    const deliveries = await CardDelivery.find({ import_batch_id: batchId })
      .sort({ imported_at: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, deliveries });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Failed to load batch deliveries" });
  }
});
module.exports = router;
