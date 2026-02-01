// models/Notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient_user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null // ✅ optional so old code won’t break
    },


    // Who should see it
    recipient_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    target_roles: { type: [String], default: [] }, // ["operations","admin"]
    target_user_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // optional if you want per-user

    // Classification
    category: { type: String, required: true }, // e.g. EXCEPTION_ALERT, RISK_OVERSIGHT, PROCESS_ALERT
    severity: { type: String, enum: ["info", "warning", "critical"], default: "info" },

    // Display
    title: { type: String, required: true },
    message: { type: String, default: "" },

    // Structured payload (lets you render bullets, fields, etc.)
    data: { type: Object, default: {} },

    // Links
    link_url: { type: String, default: "" }, // "/exceptions", "/admin/review", etc.

    // Dedupe (prevent spam)
    dedupe_key: { type: String, index: true, default: "" },

    // State
    is_read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
