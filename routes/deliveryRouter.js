// routes/deliveryRouter.js
const express = require("express");
const router = express.Router();

const crypto = require("crypto");
const multer = require("multer");
const xlsx = require("xlsx");
const { body, validationResult } = require("express-validator");

const authMiddleware = require("../middleware/authMiddleware");
const { addAuditLog } = require("../utils/audit");
const CardDelivery = require("../models/CardDelivery");

// Multer: temporary upload folder
const upload = multer({ dest: "uploads/" });

console.log("[deliveryRouter] loaded");

// ✅ Admin/Ops only for ALL /deliveries routes
router.use(authMiddleware, (req, res, next) => {
  if (!req.user || !["admin", "operations"].includes(req.user.role)) {
    return res.status(403).send("Access denied");
  }
  next();
});

// Helper: mask card for logs (PDPA – only last 4 digits)
function last4(card) {
  if (!card) return "****";
  const clean = String(card).replace(/\s+/g, "");
  return clean.slice(-4);
}

// Reusable validation rules for a single delivery (FR24)
const deliveryValidationRules = [
  body("card_number").trim().matches(/^\d{16}$/).withMessage("Card number must be 16 digits"),
  body("recipient_name")
    .trim()
    .notEmpty()
    .withMessage("Recipient name is required")
    .isLength({ max: 100 })
    .withMessage("Recipient name too long"),
  body("address").trim().notEmpty().withMessage("Address is required"),
  body("courier").optional({ checkFalsy: true }).isLength({ max: 50 }).withMessage("Courier name too long"),
  body("status").optional().isIn(["Pending", "Shipped", "Delivered", "Failed"]).withMessage("Invalid status value"),
];

function toUpperTrim(v) {
  return String(v ?? "").trim().toUpperCase();
}
function cleanDigits(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

/** Reads the sheet as a 2D array, finds the header row and return objects. */
function parseProgressiveReportRows(sheet) {
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  let headerRowIndex = -1;

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i].map(toUpperTrim);
    // Look for headers that include STATUS (which is the Progressive Report section)
    if (row.includes("STATUS") && row.includes("NAME") && row.includes("ADDRESS1")) {
      headerRowIndex = i;
      console.log("[Import Parser] Found Progressive Report section with STATUS at row", i);
      break;
    }
  }

  // If not found, fallback to the first section without status
  if (headerRowIndex === -1) {
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i].map(toUpperTrim);
      if (row.includes("REFERENCE NUMBER") && row.includes("NAME") && row.includes("ADDRESS1")) {
        headerRowIndex = i;
        console.log("[Import Parser] Found Dispatch List section at row", i);
        break;
      }
    }
  }

  if (headerRowIndex === -1) {
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i].map(toUpperTrim);
      if (row.includes("NAME") && row.includes("ADDRESS1")) {
        headerRowIndex = i;
        console.log("[Import Parser] Found basic header at row", i);
        break;
      }
    }
  }

  if (headerRowIndex === -1) return [];

  const headers = matrix[headerRowIndex].map((h) => String(h).trim());
  
  // Debug logging to see what columns are detected
  console.log("[Import Parser] Detected headers:", headers);

  const out = [];

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r];
    const hasAny = row.some((cell) => String(cell).trim() !== "");
    if (!hasAny) continue;

    const obj = {};
    // Store numeric indices for direct column access
    for (let c = 0; c < row.length; c++) {
      obj[c] = row[c];
    }
    // Also store named properties from headers
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = row[c];
    }
    out.push(obj);
  }
  return out;
}

function pickCardNumber(row) {
  const panDigits = cleanDigits(row["PAN"]);
  if (panDigits.length === 16) return panDigits;

  const ref = String(row["REFERENCE NUMBER"] ?? "").trim();
  if (cleanDigits(ref).length > 0) return ref;

  const awb = String(row["AWB NUMBER"] ?? "").trim();
  if (cleanDigits(awb).length > 0) return awb;

  return "";
}

/** Pick status from row - gets from column O (index 14) */
function pickStatus(row) {
  //  Get value directly from column O (index 14)
  let value = String(row[14] ?? "").trim();
  if (value) return value;

  //  Fallback: check for STATUS column header
  value = String(row["STATUS"] ?? "").trim();
  if (value) return value;

  return "";
}

/** Validate import row */
function validateProgressiveRow(row) {
  const name = String(row["NAME"] ?? "").trim();
  const nameUpper = toUpperTrim(name);
  if (!name) return false;
  if (nameUpper === "NAME" || nameUpper === "SHPR_NAME") return false;

  const addressParts = [row["ADDRESS1"], row["ADDRESS2"], row["ADDRESS3"], row["ADDRESS4"], row["CITY"], row["ZIPCODE"]]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);

  if (addressParts.length === 0) return false;

  const addressJoinedUpper = toUpperTrim(addressParts.join(" "));
  if (addressJoinedUpper.includes("ADDRESS1") && addressJoinedUpper.includes("ADDRESS2")) return false;

  const card_number = pickCardNumber(row);
  if (!card_number) return false;

  return true;
}

function buildAddress(row) {
  const parts = [row["ADDRESS1"], row["ADDRESS2"], row["ADDRESS3"], row["ADDRESS4"], row["CITY"], row["ZIPCODE"]]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

function mapFileStatusToAppStatus(fileStatus) {
  // ✅ Just return whatever is in the STATUS column as-is
  const s = String(fileStatus ?? "").trim();
  
  // ✅ Log what we're getting
  if (s) {
    console.log(`[Import] Raw status value: "${s}"`);
  }
  
  // Return the raw value, or empty string if nothing
  return s || "";
}

// ==========================
// GET /deliveries (admin/ops)
// Supports ?batchId= and/or ?status=
// ==========================
router.get("/", async (req, res) => {
  try {
    const batchId = req.query.batchId || null;
    const status = req.query.status || null;

    const filter = {};
    if (batchId) filter.import_batch_id = batchId;
    if (status) filter.status = status;

    let deliveries = [];
    if (batchId || status) {
      deliveries = await CardDelivery.find(filter).sort({ updated_at: -1 }).lean();
    } else {
      deliveries = await CardDelivery.find({}).sort({ updated_at: -1 }).limit(100).lean();
    }

    deliveries = deliveries.map((d) => ({ ...d, id: d._id.toString() }));

    return res.render("deliveries", {
      deliveries,
      batchId,
      selectedStatus: status,
    });
  } catch (err) {
    console.error("Error fetching deliveries:", err);
    return res.status(500).send("Error loading deliveries");
  }
});

// ==========================
// POST /deliveries (create)
// ==========================
router.post("/", deliveryValidationRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.warn("[Create Delivery] Validation failed:", errors.array());
    return res.status(400).send("Validation error: " + errors.array().map((e) => e.msg).join(", "));
  }

  try {
    const { card_number, recipient_name, address, courier } = req.body;

    const created = await CardDelivery.create({
      card_number,
      recipient_name,
      address,
      courier,
      status: "Pending",
      updated_at: new Date(),

      // ✅ Option A: leave unassigned unless you add UI to choose printer
      assigned_printer: null,
    });

    await addAuditLog(req, {
      action_type: "CREATE_DELIVERY",
      entity_type: "CardDelivery",
      entity_id: created._id.toString(),
      source: "Deliveries Page",
      remarks: `Created delivery for card **** **** **** ${last4(card_number)}`,
    });

    return res.redirect("/deliveries");
  } catch (err) {
    console.error("Error creating delivery:", err);
    return res.status(500).send("Error creating delivery");
  }
});

// ==========================
// POST /deliveries/import
// - If form provides assigned_printer_id,
// - Else null 
// ==========================
router.post("/import", upload.single("excel_file"), async (req, res) => {
  try {
    if (!req.file) return res.redirect("/deliveries");

    const batchId = crypto.randomUUID();

    // ✅ If your import form has a dropdown <select name="assigned_printer_id">
    const assignedPrinterId = (req.body.assigned_printer_id || "").trim() || null;

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = parseProgressiveReportRows(sheet);

    console.log("[Import] Parsed rows:", rows.length);

    const docs = [];
    let invalidCount = 0;
    let duplicateCount = 0;
    let updatedCount = 0;

    for (const row of rows) {
      if (!validateProgressiveRow(row)) {
        invalidCount++;
        continue;
      }

      const card_number = pickCardNumber(row);
      const recipient_name = String(row["NAME"] ?? "").trim();
      const address = buildAddress(row);
      const courier = String(row["PORT"] ?? "-").trim() || "-";
      const pickedStatus = pickStatus(row);
      const status = mapFileStatusToAppStatus(pickedStatus);

      // ✅ Debug logging to see what status is being extracted
      console.log(`[Import] Row: ${card_number} | Picked Status: "${pickedStatus}" | Mapped Status: "${status}"`);

      // Check for duplicate: same card_number, recipient_name, and address
      const existingDelivery = await CardDelivery.findOne({
        card_number: card_number,
        recipient_name: recipient_name,
        address: address,
      }).lean();

      if (existingDelivery) {
        // ✅ Only update if the new status is non-empty AND different from existing
        if (status && existingDelivery.status !== status) {
          console.log(`[Import] Status change detected: ${card_number} - ${recipient_name} (${existingDelivery.status} → ${status})`);
          
          // ✅ Update status AND assign to current batch so it shows in the session
          await CardDelivery.updateOne(
            { _id: existingDelivery._id },
            { 
              $set: { 
                status: status,
                updated_at: new Date(),
                import_batch_id: batchId,
                imported_by: req.user?._id?.toString() || req.user?.email || req.user?.name || "system",
                imported_at: new Date()
              } 
            }
          );
          
          updatedCount++;
          
          // ✅ Log the status update in audit trail
          await addAuditLog(req, {
            action_type: "UPDATE_DELIVERY_STATUS",
            entity_type: "CardDelivery",
            entity_id: existingDelivery._id.toString(),
            source: "Import (Status Update)",
            remarks: `Status updated via import for card **** **** **** ${last4(card_number)}: ${existingDelivery.status} → ${status}`,
            import_batch_id: batchId,
          });
        } else {
          // Status is empty or same, skip as duplicate
          console.log(`[Import] Skipping duplicate: ${card_number} - ${recipient_name} (status: "${status}")`);
          duplicateCount++;
        }
        continue;
      }

      docs.push({
        card_number,
        recipient_name,
        address,
        courier,
        status,
        updated_at: new Date(),

        import_batch_id: batchId,
        imported_by: req.user?._id?.toString() || req.user?.email || req.user?.name || "system",
        imported_at: new Date(),

        // ✅ Option A assignment
        assigned_printer: assignedPrinterId, // ObjectId string or null
      });
    }

    if (docs.length === 0 && updatedCount === 0) {
      console.warn("[Import] No valid rows found in file");
      return res.redirect("/deliveries");
    }

    let result = [];
    if (docs.length > 0) {
      result = await CardDelivery.insertMany(docs);
    }
    console.log(`[Import] Inserted ${result.length}. Invalid: ${invalidCount}. Duplicates: ${duplicateCount}. Updated: ${updatedCount}`);

    await addAuditLog(req, {
      action_type: "IMPORT_DELIVERIES",
      entity_type: "CardDelivery",
      entity_id: "BULK",
      source: "Deliveries Import",
      remarks: `Imported ${result.length} new deliveries. Skipped ${invalidCount} invalid rows, ${duplicateCount} duplicates, and updated ${updatedCount} existing entries with status changes.`,
      import_batch_id: batchId, // ✅ needed for auditLog expand “View”
    });

    return res.redirect(`/deliveries?batchId=${encodeURIComponent(batchId)}`);
  } catch (err) {
    console.error("Error importing deliveries:", err);
    if (res.headersSent) return;
    return res.status(500).send("Error importing deliveries");
  }
});

router.post("/clear-session", (req, res) => {
  res.clearCookie("last_import_batch");
  return res.redirect("/deliveries");
});

// ==========================
// POST /deliveries/:id/status
// ==========================
router.post("/:id/status", async (req, res) => {
  try {
    const deliveryId = req.params.id;
    const new_status = req.body.status;
    const batchId = req.body.batchId;

    const allowedStatuses = [
      "Pending",
      "Pulled Out",
      "Not Found",
      "Handed to Courier",
      "Delivered",
      "Returned to Printer",
      "Destroyed",
      "Reprocessing",
      "Failed",
    ];
    if (!allowedStatuses.includes(new_status)) return res.status(400).send("Invalid status");

    const existing = await CardDelivery.findById(deliveryId).lean();
    const oldStatus = existing?.status ?? null;

    await CardDelivery.findByIdAndUpdate(deliveryId, { status: new_status, updated_at: new Date() });

    await addAuditLog(req, {
      action_type: "UPDATE_STATUS",
      entity_type: "CardDelivery",
      entity_id: deliveryId,
      field: "status",
      old_value: oldStatus,
      new_value: new_status,
      source: "Deliveries Page",
    });

    const redirectBatch = batchId || existing?.import_batch_id;
    return res.redirect(redirectBatch ? `/deliveries?batchId=${encodeURIComponent(redirectBatch)}` : "/deliveries");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Error updating delivery status");
  }
});

router.post("/wip", async (req, res) => {
  return res.status(403).render("wip");
});

module.exports = router;
