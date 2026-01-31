// models/ReviewNote.js
const mongoose = require("mongoose");

const reviewNoteSchema = new mongoose.Schema(
  {
    incident_id: { type: String, required: true, index: true },

    review_status: {
      type: String,
      enum: ["pending", "investigating", "approved"],
      default: "pending",
    },

    review_comment: { type: String, default: "" },

    reviewed_by: {
      user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      username: { type: String, default: "admin" },
    },

    reviewed_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ReviewNote", reviewNoteSchema);
