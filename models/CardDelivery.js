// models/CardDelivery.js
const mongoose = require("mongoose");

const STATUS = [
  "Delivered",
  "Bad Address",
  "Consignee Not Around",
  "Denied Entry/Access",
  "Flooded Area",
  "Office Close",
  "Relocated",
  "Refuse to Accept",
  "Transfer",
  "Unlocated",
  "Return to Centre",
  "Return to Sender",
  "No Updates",
  "PENDING",
  "IN TRANSIT",
  "RETURNED",
  "FAILED",
];

const cardDeliverySchema = new mongoose.Schema(
  {
    // Record type: card, rts, dispatch, or progressive
    record_type: {
      type: String,
      enum: ["card", "rts", "dispatch", "progressive"],
      default: "card",
      index: true,
    },

    // Basic card delivery fields
    card_number: { type: String, trim: true },
    recipient_name: { type: String, trim: true },
    address: { type: String, trim: true },
    courier: { type: String, trim: true, default: "-" },

    // ✅ enforce your allowed statuses
    status: { type: String, enum: STATUS, default: "PENDING", index: true },

    updated_at: { type: Date, default: Date.now },

    assigned_printer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    import_batch_id: { type: String, index: true },
    imported_by: { type: String }, // user id/email/name
    imported_at: { type: Date, index: true },

    // RTS-specific fields
    ship_name: { type: String, trim: true },
    pickup_date: { type: String, trim: true },
    code: { type: String, trim: true },
    rts_awb: { type: String, trim: true },
    cnee_zip: { type: String, trim: true },
    dest_port: { type: String, trim: true },
    cnee_name: { type: String, trim: true },
    cnee_street: { type: String, trim: true },
    date_received: { type: String, trim: true },
    reason: { type: String, trim: true },
    remarks: { type: String, trim: true },
    cnee_contact_no: { type: String, trim: true },
    reference: { type: String, trim: true },
    attachment: { type: String, trim: true },
    new_attachment: { type: String, trim: true },

    // Dispatch List & Progressive Report fields
    number: { type: Number, default: 0 },
    no: { type: Number, default: 0 },

    name: { type: String, trim: true },
    pan: { type: String, default: "", trim: true },

    address1: { type: String, default: "", trim: true },
    address2: { type: String, default: "", trim: true },
    address3: { type: String, default: "", trim: true },
    address4: { type: String, default: "", trim: true },

    city: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    country: { type: String, default: "", trim: true },

    zipCode: { type: String, default: "", trim: true },
    mobileNo: { type: String, default: "", trim: true, index: true },

    product: { type: String, default: "", trim: true },
    referenceNumber: { type: String, trim: true, index: true },
    fileName: { type: String, default: "", trim: true },

    awbNumber: { type: String, default: "", trim: true, index: true },
    dispatchDate: { type: Date, default: null },

    receivedBy: { type: String, default: "", trim: true },
    receivedDate: { type: Date, default: null },

    port: { type: String, default: "", trim: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

// Optional: expose statuses to other parts of app if needed
cardDeliverySchema.statics.STATUS = STATUS;

// Indexes for performance
cardDeliverySchema.index({ card_number: 1, recipient_name: 1, address: 1 });
cardDeliverySchema.index({ referenceNumber: 1, fileName: 1 });
cardDeliverySchema.index({ referenceNumber: 1, awbNumber: 1 });
cardDeliverySchema.index({ status: 1, port: 1 });
cardDeliverySchema.index({ record_type: 1 });
cardDeliverySchema.index({ record_type: 1, import_batch_id: 1 });

// Prevent model overwrite in dev (nodemon)
module.exports =
  mongoose.models.CardDelivery ||
  mongoose.model("CardDelivery", cardDeliverySchema);
