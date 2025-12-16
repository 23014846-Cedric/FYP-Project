// models/CardDelivery.js
const mongoose = require('mongoose');

// High-level lifecycle of a card delivery
const STATUS = [
  'Pending',             // created, not yet handed to courier
  'Pulled Out',          // removed from batch before courier
  'Not Found',           // address / recipient issue
  'Handed to Courier',   // with 2GO / LBC
  'Delivered',           // successful delivery
  'Returned to Printer', // sent back to Idemia
  'Destroyed',           // destroyed by Idemia
  'Reprocessing'         // reprinted / preparing redelivery
];

const cardDeliverySchema = new mongoose.Schema(
  {
    card_number: { type: String, required: true, trim: true },
    recipient_name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    courier: { type: String, trim: true, default: "-" },
    status: { type: String, enum: STATUS, default: 'Pending' },
    updated_at: { type: Date, default: Date.now },

    //import tracking
    import_batch_id: { type: String, index: true },     
    imported_by: { type: String, trim: true },          
    imported_at: { type: Date, default: Date.now },     
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false }
  }
);

module.exports = mongoose.model("CardDelivery", cardDeliverySchema);