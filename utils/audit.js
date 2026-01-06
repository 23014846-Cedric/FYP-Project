// utils/audit.js
const crypto = require("crypto");
const AuditLog = require("../models/AuditLog");

async function addAuditLog(req, payload) {
  try {
    const timestamp = new Date();

    const userId = req.user?.id || req.user?._id || null;
    const username = req.user?.name || req.user?.email || "System";
    const role = req.user?.role || "";

    const safeOld =
      payload.old_value !== undefined && payload.old_value !== null
        ? String(payload.old_value)
        : "";
    const safeNew =
      payload.new_value !== undefined && payload.new_value !== null
        ? String(payload.new_value)
        : "";

    const summaryString = [
      String(userId || ""),
      String(role),
      String(payload.action_type || ""),
      String(payload.entity_type || ""),
      String(payload.entity_id || ""),
      String(payload.field || ""),
      safeOld,
      safeNew,
      String(payload.import_batch_id || ""),
      timestamp.toISOString(),
    ].join("|");

    const logHash =
      "0x" + crypto.createHash("sha256").update(summaryString).digest("hex");

    const log = await AuditLog.create({
      timestamp,
      username,
      user_id: userId,
      action_type: payload.action_type,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      field: payload.field || null,
      old_value: safeOld || null,
      new_value: safeNew || null,
      source: payload.source || "Web",
      remarks: payload.remarks || "",
      import_batch_id: payload.import_batch_id || null,
      summaryString,
      logHash,
    });

    return log;
  } catch (err) {
    console.error("addAuditLog failed:", err);
    return null;
  }
}

module.exports = { addAuditLog };
