const crypto = require("crypto");
const AuditLog = require("../models/AuditLog");

// Central audit writer: always computes hash for blockchain anchoring
async function addAuditLog(req, {
  action_type,
  entity_type,
  entity_id,
  field = null,
  old_value = null,
  new_value = null,
  source = "Web",
  remarks = "",
}) {
  try {
    const timestamp = new Date();

    const safeOld = old_value !== undefined && old_value !== null ? String(old_value) : "";
    const safeNew = new_value !== undefined && new_value !== null ? String(new_value) : "";

    const summaryString = [
      req?.user?.id || "",
      req?.user?.role || "",
      action_type || "",
      entity_type || "",
      entity_id || "",
      field || "",
      safeOld,
      safeNew,
      timestamp.toISOString(),
    ].join("|");

    const logHash = "0x" + crypto.createHash("sha256").update(summaryString).digest("hex");

    const log = await AuditLog.create({
      timestamp,
      username: req?.user?.name || "System",
      user_id: req?.user?.id || null,
      action_type,
      entity_type,
      entity_id,
      field,
      old_value: safeOld || null,
      new_value: safeNew || null,
      source,
      remarks,
      summaryString,
      logHash,
    });

    return log;
  } catch (err) {
    console.error("addAuditLog error:", err);
    return null;
  }
}

module.exports = { addAuditLog };
