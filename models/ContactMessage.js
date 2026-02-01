// models/ContactMessage.js
const mongoose = require("mongoose");

const contactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    company: { type: String },
    topic: {
      type: String,
      enum: ["demo", "integration", "operations", "support", "other", ""],
      default: ""
    },
    message: { type: String, required: true },

    // For operations team use:
    status: {
      type: String,
      enum: ["new", "in_progress", "closed"],
      default: "new"
    },
    internalNotes: { type: String },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    createdByIp: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("ContactMessage", contactMessageSchema);
