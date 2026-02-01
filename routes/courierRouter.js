// routes/courierRouter.js
const express = require("express");
const router = express.Router();

const crypto = require("crypto");
const multer = require("multer");
const xlsx = require("xlsx");

const authMiddleware = require("../middleware/authMiddleware");
const { addAuditLog } = require("../utils/audit");
const CardDelivery = require("../models/CardDelivery");

// Multer: temporary upload folder (same as deliveryRouter)
const upload = multer({ dest: "uploads/" });

console.log("[courierRouter] loaded");

// ✅ Courier only for ALL /courier routes
router.use(authMiddleware, (req, res, next) => {
  if (!req.user || req.user.role !== "courier") {
    return res.status(403).send("Access denied");
  }
  next();
});

function toUpperTrim(v) {
  return String(v ?? "").trim().toUpperCase();
}
function cleanDigits(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

/** Reads the sheet as a 2D array, finds the header row and returns objects (same concept). */
function parseProgressiveReportRows(sheet) {
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  let headerRowIndex = -1;

  // Strict header detection
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i].map(toUpperTrim);
    if (row.includes("REFERENCE NUMBER") && row.includes("NAME") && row.includes("ADDRESS1")) {
      headerRowIndex = i;
      break;
    }
  }

  // Fallback header detection
  if (headerRowIndex === -1) {
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i].map(toUpperTrim);
      if (row.includes("NAME") && row.includes("ADDRESS1")) {
        headerRowIndex = i;
        break;
      }
    }
  }

  if (headerRowIndex === -1) return [];

  const headers = matrix[headerRowIndex].map((h) => String(h).trim());
  const out = [];

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r];
    const hasAny = row.some((cell) => String(cell).trim() !== "");
    if (!hasAny) continue;

    const obj = {};
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

/** Validate import row (same concept) */
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

function pickStatus(row) {
  // Try multiple common status column names - case-sensitive variations
  let value = String(row["Status"] ?? "").trim();
  console.log("[pickStatus] Checking 'Status' column:", value);
  if (value) return value;

  value = String(row["STATUS"] ?? "").trim();
  console.log("[pickStatus] Checking 'STATUS' column:", value);
  if (value) return value;

  // Try uppercase variations
  value = String(row["DELIVERY_STATUS"] ?? "").trim();
  console.log("[pickStatus] Checking 'DELIVERY_STATUS' column:", value);
  if (value) return value;

  value = String(row["STATUS_UPDATE"] ?? "").trim();
  console.log("[pickStatus] Checking STATUS_UPDATE column:", value);
  if (value) return value;

  console.log("[pickStatus] No status found in any column, returning empty string");
  return "";
}

function mapFileStatusToAppStatus(fileStatus) {
  const s = toUpperTrim(fileStatus);
  console.log("[Courier Status Map] Input:", fileStatus, "Normalized:", s);
  
  // Direct mappings - exact matches
  const statusMap = {
    "DELIVERED": "Delivered",
    "REPROCESSING": "PENDING",  // Reprocessing items treated as PENDING
    "BAD ADDRESS": "Bad Address",
    "CONSIGNEE NOT AROUND": "Consignee Not Around",
    "DENIED ENTRY": "Denied Entry/Access",
    "DENIED ENTRY/ACCESS": "Denied Entry/Access",
    "FLOODED AREA": "Flooded Area",
    "OFFICE CLOSE": "Office Close",
    "OFFICE CLOSED": "Office Close",
    "RELOCATED": "Relocated",
    "REFUSE TO ACCEPT": "Refuse to Accept",
    "REFUSE": "Refuse to Accept",
    "TRANSFER": "Transfer",
    "UNLOCATED": "Unlocated",
    "RETURN TO CENTRE": "Return to Centre",
    "RETURN TO CENTER": "Return to Centre",
    "RETURN TO SENDER": "Return to Sender",
    "NO UPDATES": "No Updates",
    "IN TRANSIT": "IN TRANSIT",
    "RETURNED": "RETURNED",
    "FAILED": "FAILED",
    "PENDING": "PENDING",
  };

  // Check for exact match first
  if (statusMap[s]) {
    console.log("[Courier Status Map] Mapped to:", statusMap[s], "(exact match)");
    return statusMap[s];
  }

  // Check for partial matches (substring matching)
  const partialMatches = {
    "BAD ADDRESS": "Bad Address",
    "CONSIGNEE": "Consignee Not Around",
    "DENIED": "Denied Entry/Access",
    "FLOODED": "Flooded Area",
    "OFFICE": "Office Close",
    "RELOCATED": "Relocated",
    "REFUSE": "Refuse to Accept",
    "TRANSFER": "Transfer",
    "UNLOCATED": "Unlocated",
    "RETURN": "Return to Sender",
    "DELIVERED": "Delivered",
    "PENDING": "PENDING"
  };

  for (const [keyword, status] of Object.entries(partialMatches)) {
    if (s.includes(keyword)) {
      console.log("[Courier Status Map] Mapped to:", status, "(partial match: " + keyword + ")");
      return status;
    }
  }

  // Default to PENDING if no match found
  console.log("[Courier Status Map] No match found, defaulting to PENDING");
  return "PENDING";
}

// ==========================
// GET /courier/deliveries
// - If ?batchId= provided: show that batch (only if imported_by is courier)
// - Else: show courier's latest batch
// ==========================
router.get("/deliveries", async (req, res) => {
  try {
    const importedBy = req.user?.email;
    const batchId = (req.query.batchId || "").trim() || null;

    // ✅ No batchId = empty page (fresh login)
    if (!batchId) {
      return res.render("courier", { deliveries: [], batchId: "" });
    }

    // ✅ Only show the batch the courier just imported
    const deliveries = await CardDelivery.find({
      import_batch_id: batchId,
      imported_by: importedBy,
    })
      .sort({ updated_at: -1, _id: -1 })
      .lean();

    return res.render("courier", { deliveries, batchId });
  } catch (err) {
    console.error("Error fetching courier deliveries:", err);
    return res.status(500).send("Error loading courier deliveries");
  }
});


// ==========================
// POST /courier/deliveries/import
// - Parse file (same concept as deliveryRouter)
// - Save into CardDelivery
// - AuditLog with import_batch_id
// - Redirect to /courier/deliveries?batchId=...
// ==========================
router.post("/deliveries/import", upload.single("excel_file"), async (req, res) => {
  try {
    if (!req.file) return res.redirect("/courier/deliveries");

    const batchId = crypto.randomUUID();

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = parseProgressiveReportRows(sheet);

    console.log("[Courier Import] Parsed rows:", rows.length);

    // Debug: Print first row to see all columns
    if (rows.length > 0) {
      console.log("[Excel Debug] First row keys:", Object.keys(rows[0]));
      console.log("[Excel Debug] First row values:", rows[0]);
    }

    const docs = [];
    let invalidCount = 0;

    for (const row of rows) {
      if (!validateProgressiveRow(row)) {
        invalidCount++;
        continue;
      }

      const card_number = pickCardNumber(row);
      const recipient_name = String(row["NAME"] ?? "").trim();
      const address = buildAddress(row);

      // If your file has PORT / Courier info, else set to courier email
      const courier = String(row["PORT"] ?? "").trim() || req.user.email || "-";
      const pickedStatus = pickStatus(row);
      const status = mapFileStatusToAppStatus(pickedStatus);

      console.log(`[Courier Import] Row: ${card_number} | Name: ${recipient_name} | Picked Status: "${pickedStatus}" | Mapped Status: "${status}"`);

      docs.push({
        card_number,
        recipient_name,
        address,
        courier,
        status,
        updated_at: new Date(),

        import_batch_id: batchId,
        imported_by: req.user.email,     // ✅ critical: filter on GET
        imported_at: new Date(),

        // courier should not assign printer
        assigned_printer: null,
      });
    }

    if (docs.length === 0) {
      console.warn("[Courier Import] No valid rows found. Invalid:", invalidCount);
      return res.status(400).send(
        "No valid rows found in file. Ensure it contains columns like: Reference Number / Name / Address1."
      );
    }

    const result = await CardDelivery.insertMany(docs);
    console.log(`[Courier Import] Inserted ${result.length}. Invalid: ${invalidCount}`);

    await addAuditLog(req, {
      action_type: "IMPORT_DELIVERIES",
      entity_type: "CardDelivery",
      entity_id: "BULK",
      source: "Courier Import",
      remarks: `Courier imported ${result.length} deliveries. Skipped ${invalidCount} invalid rows.`,
      import_batch_id: batchId, // ✅ same as deliveryRouter
    });

    return res.redirect(`/courier/deliveries?batchId=${encodeURIComponent(batchId)}`);
  } catch (err) {
    console.error("Error importing courier deliveries:", err);
    if (res.headersSent) return;
    return res.status(500).send("Error importing deliveries");
  }
});

module.exports = router;
