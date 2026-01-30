// models/CardDelivery.js
const mongoose = require("mongoose");

const STATUS = [
  "Delivered","Bad Address","Consignee No","Denied Entry",
  "Flooded Area","Office Close","Relocated","Refuse to Accept",
  "Transfer","Unlocated","Return to Centre","Return to Sender",
  "No Updates"
];

const cardDeliverySchema = new mongoose.Schema(
  {
    card_number: { type: String, required: true, trim: true },
    recipient_name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    courier: { type: String, trim: true, default: "-" },
    status: { type: String, default: "Pending" },
    updated_at: { type: Date, default: Date.now },
    
    assigned_printer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

    import_batch_id: { type: String, index: true },
    imported_by: { type: String }, // user id/email/name
    imported_at: { type: Date },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

// ✅ Add compound index to prevent duplicates and improve duplicate detection queries
cardDeliverySchema.index({ card_number: 1, recipient_name: 1, address: 1 });

module.exports = mongoose.model("CardDelivery", cardDeliverySchema);
