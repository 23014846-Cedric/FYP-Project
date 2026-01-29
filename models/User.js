// models/User.js
const mongoose = require('mongoose');

// Updated roles – business users only
const ALLOWED_ROLES = ['admin', 'operations', 'printer', 'courier'];

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },

  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },

  passwordHash: { type: String, required: true },

  role: {
    type: String,
    enum: ALLOWED_ROLES,
    default: 'operations'   // default staff = operations
  }
});

module.exports = mongoose.model("User", userSchema);
