// models/AuditLog.js
const mongoose = require("mongoose");
const crypto = require("crypto");

const auditLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  action_timestamp: {type: Date,default: Date.now},

  username: { type: String, default: "System" },
  user_id: { type: String },

  action_type: { type: String, required: true },
  entity_type: { type: String, required: true },

  // Entity & Batch (used by your auditLog.ejs "View imported deliveries")
  entity_id: { type: String, default: null },
  import_batch_id: { type: String, default: null, index: true },

  field: { type: String },
  old_value: { type: String },
  new_value: { type: String },

  source: { type: String, default: "Web" },
  remarks: { type: String },

  // ✅ hash-chain fields (immutable)
  prev_hash: { type: String, default: null },
  hash: { type: String, required: true, unique: true, index: true },

  // ✅ anchoring fields (metadata) — allowed to update later
  anchored: { type: Boolean, default: false, index: true },
  anchor_batch: { type: String, default: null },
  anchor_root: { type: String, default: null },
  anchor_tx: { type: String, default: null },
  anchored_at: { type: Date, default: null },
});

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * IMPORTANT:
 * - Mongoose validates required fields before `save`.
 * - So compute hash in `pre("validate")`.
 */
auditLogSchema.pre("validate", async function (next) {
  try {
    if (!this.isNew) return next(new Error("AuditLog is append-only"));

    if (!this.timestamp) this.timestamp = new Date();

    const last = await this.constructor
      .findOne({}, { hash: 1 })
      .sort({ timestamp: -1, _id: -1 })
      .lean();

    this.prev_hash = last?.hash || null;

    // ✅ Include import_batch_id (so audit import rows can be expanded reliably)
    // ✅ Do NOT include anchoring fields in the payload (they change later)
    const payload = {
      timestamp: new Date(this.timestamp).toISOString(),
      username: this.username,
      user_id: this.user_id || null,
      action_type: this.action_type,
      entity_type: this.entity_type,
      entity_id: this.entity_id || null,
      import_batch_id: this.import_batch_id || null,
      field: this.field || null,
      old_value: this.old_value || null,
      new_value: this.new_value || null,
      source: this.source || "Web",
      remarks: this.remarks || "",
      prev_hash: this.prev_hash,
    };

    this.hash = sha256(JSON.stringify(payload));
    return next();
  } catch (e) {
    return next(e);
  }
});

/**
 * Allow ONLY anchoring metadata updates.
 * Block any changes to the audit content fields.
 */
function onlyAnchoringUpdateAllowed(query) {
  const update = query.getUpdate() || {};

  // supports both:
  // - updateMany({..}, {$set:{...}})
  // - findOneAndUpdate({..}, {anchored:true}) (direct keys)
  const directKeys = Object.keys(update).filter((k) => !k.startsWith("$"));
  const setKeys = Object.keys(update.$set || {});
  const unsetKeys = Object.keys(update.$unset || {});
  const updatedKeys = new Set([...directKeys, ...setKeys, ...unsetKeys]);

  const ALLOWED = new Set([
    "anchored",
    "anchor_batch",
    "anchor_root",
    "anchor_tx",
    "anchored_at",
  ]);

  for (const k of updatedKeys) {
    if (!ALLOWED.has(k)) {
      throw new Error("AuditLog is append-only (only anchoring metadata can be updated)");
    }
  }
}

// ✅ block edits, except anchoring metadata
["updateOne", "updateMany", "findOneAndUpdate"].forEach((h) => {
  auditLogSchema.pre(h, function () {
    return onlyAnchoringUpdateAllowed(this);
  });
});

// ✅ always block deletes
["deleteOne", "deleteMany", "findOneAndDelete"].forEach((h) => {
  auditLogSchema.pre(h, () => {
    throw new Error("AuditLog is append-only (deletes are not allowed)");
  });
});

module.exports = mongoose.model("AuditLog", auditLogSchema);
