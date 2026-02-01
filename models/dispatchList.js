const mongoose = require("mongoose");

const DispatchListSchema = new mongoose.Schema(
  {
    no: { type: Number, default: 0 },

    name: { type: String, required: true, trim: true },
    pan: { type: String, default: "", trim: true },

    address1: { type: String, default: "", trim: true },
    address2: { type: String, default: "", trim: true },
    address3: { type: String, default: "", trim: true },
    address4: { type: String, default: "", trim: true },

    city: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    country: { type: String, default: "", trim: true },

    zipCode: { type: String, default: "", trim: true },
    mobileNo: { type: String, default: "", trim: true },

    product: { type: String, default: "", trim: true },
    referenceNumber: { type: String, required: true, trim: true, index: true },
    fileName: { type: String, default: "", trim: true },

    awbNumber: { type: String, default: "", trim: true, index: true },
    dispatchDate: { type: Date, default: null },

    status: { type: String, default: "PENDING", trim: true },

    // Batch tracking (for imports)
    import_batch_id: { type: String, index: true },
    imported_by: { type: String }, // user id/email/name
    imported_at: { type: Date },
  },
  { timestamps: true }
);

// Useful indexes
DispatchListSchema.index({ referenceNumber: 1, fileName: 1 });
DispatchListSchema.index({ awbNumber: 1 });
DispatchListSchema.index({ import_batch_id: 1 });

// Prevent model overwrite in dev (nodemon)
module.exports =
  mongoose.models.DispatchList ||
  mongoose.model("DispatchList", DispatchListSchema);
