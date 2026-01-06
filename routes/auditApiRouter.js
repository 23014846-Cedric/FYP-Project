const express = require("express");
const router = express.Router();

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

module.exports = router;
