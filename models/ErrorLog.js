// models/ErrorLog.js
const mongoose = require('mongoose');

const errorLogSchema = new mongoose.Schema({
  message: {
    type: String,
    required: true,
  },
  stack: {
    type: String,
  },
  statusCode: {
    type: Number,
    default: 500,
  },
  route: String,
  method: String,
  userId: {
    type: String,
  },
  userEmail: {
    type: String,
  },
  userRole: {
    type: String,
  },
  ip: String,
  userAgent: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('ErrorLog', errorLogSchema);
