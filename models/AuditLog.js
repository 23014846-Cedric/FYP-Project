// models/AuditLog.js
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
  },

  username: {
    type: String,
    default: 'System',
  },

  user_id: {
    type: String,
  },

  action_type: {
    type: String,          // e.g. UPDATE_STATUS, IMPORT_DELIVERIES, CREATE_DELIVERY
    required: true,
  },

  entity_type: {
    type: String,          // e.g. "CardDelivery", "User"
    // keep required if you want, or relax it too:
    required: true,
  },

  entity_id: {
    type: String,
    required: false,
    default: null,
  },

  field: {
    type: String,          // e.g. "status"
  },

  old_value: {
    type: String,
  },

  new_value: {
    type: String,
  },

  source: {
    type: String,
    default: 'Web',
  },

  remarks: {
    type: String,
  },
});

// Auto-delete audit logs 90 days after timestamp
auditLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }  // 90 days
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
