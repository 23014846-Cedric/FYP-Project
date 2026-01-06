// models/CardDelivery.js
const mongoose = require("mongoose");

const STATUS = [
  "Pending",
  "Pulled Out",
  "Not Found",
  "Handed to Courier",
  "Delivered",
  "Returned to Printer",
  "Destroyed",
  "Reprocessing",
];

const cardDeliverySchema = new mongoose.Schema(
  {
    card_number: { type: String, required: true, trim: true },
    recipient_name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    courier: { type: String, trim: true, default: "-" },
    status: { type: String, enum: STATUS, default: "Pending" },
    updated_at: { type: Date, default: Date.now },

    // ✅ NEW: import tracking
    import_batch_id: { type: String, index: true },
    imported_by: { type: String }, // user id/email/name
    imported_at: { type: Date },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

module.exports = mongoose.model("CardDelivery", cardDeliverySchema);
