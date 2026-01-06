// models/AuditLog.js
const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now, index: true },

    username: { type: String },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    action_type: { type: String, required: true, index: true },
    entity_type: { type: String },
    entity_id: { type: String },

    field: { type: String, default: null },
    old_value: { type: String, default: null },
    new_value: { type: String, default: null },

    source: { type: String, default: "Web" },
    remarks: { type: String, default: "" },

    // ✅ NEW: link audit log to import batch
    import_batch_id: { type: String, index: true, default: null },

    // ✅ NEW: for anchoring
    summaryString: { type: String, default: null },
    logHash: { type: String, default: null },
    txHash: { type: String, default: null },
  },
  { versionKey: false }
);

// Optional helpful compound indexes
auditLogSchema.index({ action_type: 1, timestamp: -1 });
auditLogSchema.index({ import_batch_id: 1, timestamp: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
