const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
timestamp: { type: Date, default: Date.now,},

  import_batch_id: { type: String, index: true },
  
  username: { type: String, default: 'System' },
  user_id: { type: String },

  action_type: { type: String, required: true },
  entity_type: { type: String, required: true },
  entity_id: { type: String, default: null },

  field: { type: String },
  old_value: { type: String },
  new_value: { type: String },

  source: { type: String, default: 'Web' },
  remarks: { type: String },

  // NEW hybrid-blockchain fields
  summaryString: { type: String },
  logHash: { type: String, index: true }, // 0x + sha256 hex
  txHash: { type: String },              // ethereum tx hash
});

// ✅ auto-delete after 90 days
auditLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
