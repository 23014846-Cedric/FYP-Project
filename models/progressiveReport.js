const mongoose = require("mongoose");

const ProgressiveReportSchema = new mongoose.Schema(
  {
    number: { type: Number, default: 0 },

    name: { type: String, required: true, trim: true },
    pan: { type: String, default: "", trim: true },

    address1: { type: String, default: "", trim: true },
    address2: { type: String, default: "", trim: true },
    address3: { type: String, default: "", trim: true },
    address4: { type: String, default: "", trim: true },

    zipCode: { type: String, default: "", trim: true },
    mobileNo: { type: String, default: "", trim: true },

    product: { type: String, default: "", trim: true },
    referenceNumber: { type: String, required: true, trim: true, index: true },
    fileName: { type: String, default: "", trim: true },

    awbNumber: { type: String, default: "", trim: true, index: true },
    dispatchDate: { type: Date, default: null },

    receivedBy: { type: String, default: "", trim: true },
    receivedDate: { type: Date, default: null },

    status: { type: String, default: "", trim: true },   // e.g. DELIVERED
    remarks: { type: String, default: "", trim: true },  // e.g. DEL
    port: { type: String, default: "", trim: true },     // e.g. NAB
  },
  { timestamps: true }
);

// Useful indexes
ProgressiveReportSchema.index({ referenceNumber: 1, awbNumber: 1 });
ProgressiveReportSchema.index({ status: 1, port: 1 });

// Prevent model overwrite in dev (nodemon)
module.exports =
  mongoose.models.ProgressiveReport ||
  mongoose.model("ProgressiveReport", ProgressiveReportSchema);
