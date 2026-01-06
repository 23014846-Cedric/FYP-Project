// models/AuditLog.js
const mongoose = require("mongoose");
const crypto = require("crypto");

const auditLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },

  username: { type: String, default: "System" },
  user_id: { type: String },

  action_type: { type: String, required: true },
  entity_type: { type: String, required: true },
  entity_id: { type: String, default: null },

  field: { type: String },
  old_value: { type: String },
  new_value: { type: String },

  source: { type: String, default: "Web" },
  remarks: { type: String },

  // ✅ hash-chain fields
  prev_hash: { type: String, default: null },
  hash: { type: String, required: true, unique: true, index: true },
});

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

auditLogSchema.pre("save", async function (next) {
  try {
    if (!this.isNew) return next(new Error("AuditLog is append-only"));

    const last = await this.constructor
      .findOne({}, { hash: 1 })
      .sort({ timestamp: -1, _id: -1 })
      .lean();

    this.prev_hash = last?.hash || null;

    const payload = {
      timestamp: new Date(this.timestamp).toISOString(),
      username: this.username,
      user_id: this.user_id || null,
      action_type: this.action_type,
      entity_type: this.entity_type,
      entity_id: this.entity_id || null,
      field: this.field || null,
      old_value: this.old_value || null,
      new_value: this.new_value || null,
      source: this.source || "Web",
      remarks: this.remarks || "",
      prev_hash: this.prev_hash,
    };

    this.hash = sha256(JSON.stringify(payload));
    next();
  } catch (e) {
    next(e);
  }
});

["updateOne","updateMany","findOneAndUpdate","deleteOne","deleteMany","findOneAndDelete"]
  .forEach(h => auditLogSchema.pre(h, () => { throw new Error("AuditLog is append-only"); }));

module.exports = mongoose.model("AuditLog", auditLogSchema);
