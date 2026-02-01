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

const { notifyRoles } = require("../utils/notificationService");


// Multer: temp upload folder
const upload = multer({ dest: "uploads/" });

console.log("[deliveryRouter] loaded");

// ✅ Admin/Ops only for ALL /deliveries routes
router.use(authMiddleware, (req, res, next) => {
  if (!req.user || !["admin", "operations"].includes(req.user.role)) {
    return res.status(403).send("Access denied");
  }
  next();
});

// ==========================
// Helpers
// ==========================
function last4(card) {
  if (!card) return "****";
  const clean = String(card).replace(/\s+/g, "");
  return clean.slice(-4);
}

function toUpperTrim(v) {
  return String(v ?? "").trim().toUpperCase();
}

function cleanDigits(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

function normKey(k = "") {
  return String(k).trim().toUpperCase().replace(/\s+/g, " ");
}

function parseDate(val) {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date && !isNaN(val)) return val;

  if (typeof val === "number") {
    const d = xlsx.SSF.parse_date_code(val);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
  }

  const s = String(val).trim();
  const d2 = new Date(s);
  if (!isNaN(d2)) return d2;

  return null;
}

// ==========================
// Validation rules (manual create)
// ==========================
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
  body("status")
    .optional()
    .isIn([
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
    ])
    .withMessage("Invalid status value"),
];

// ==========================
// Import Parser (Deliveries) - reads sheet as 2D and detects header row
// ==========================
function parseProgressiveReportRows(sheet) {
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  let headerRowIndex = -1;

  // Prefer Progressive section
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i].map(toUpperTrim);
    if (row.includes("STATUS") && row.includes("NAME") && row.includes("ADDRESS1")) {
      headerRowIndex = i;
      console.log("[Import Parser] Found Progressive Report section with STATUS at row", i);
      break;
    }
  }

  // Fallback Dispatch section
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

  // Final fallback
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
  console.log("[Import Parser] Detected headers:", headers);

  const out = [];
  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r];
    const hasAny = row.some((cell) => String(cell).trim() !== "");
    if (!hasAny) continue;

    const obj = {};
    for (let c = 0; c < row.length; c++) obj[c] = row[c];
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

function pickStatus(row) {
  // Try multiple common status column names
  let value = String(row["STATUS"] ?? "").trim();
  if (value) return value;

  // Column O (index 14)
  value = String(row[14] ?? "").trim();
  if (value) return value;

  // Try uppercase variations
  value = String(row["DELIVERY_STATUS"] ?? "").trim();
  if (value) return value;

  value = String(row["STATUS_UPDATE"] ?? "").trim();
  if (value) return value;

  return "";
}

function mapFileStatusToAppStatus(statusValue) {
  if (!statusValue) return "Pending";

  const status = String(statusValue).trim().toUpperCase();

  // Direct mappings - exact matches
  const statusMap = {
    "DELIVERED": "Delivered",
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
    "PENDING": "Pending"
  };

  // Check for exact match first
  if (statusMap[status]) {
    return statusMap[status];
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
    "PENDING": "Pending"
  };

  for (const [keyword, mappedStatus] of Object.entries(partialMatches)) {
    if (status.includes(keyword)) {
      return mappedStatus;
    }
  }

  // Default to Pending if no match found
  return "Pending";
}

function validateProgressiveRow(row) {
  const name = String(row["NAME"] ?? "").trim();
  const nameUpper = toUpperTrim(name);
  if (!name) return false;
  if (nameUpper === "NAME" || nameUpper === "SHPR_NAME") return false;

  const addressParts = [row["ADDRESS1"], row["ADDRESS2"], row["ADDRESS3"], row["ADDRESS4"], row["CITY"], row["ZIP CODE"]]
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
  const parts = [row["ADDRESS1"], row["ADDRESS2"], row["ADDRESS3"], row["ADDRESS4"], row["CITY"], row["ZIP CODE"]]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

function mapRTSReasonToStatus(reasonValue) {
  if (!reasonValue) return "Unlocated"; // Default status

  const reason = String(reasonValue).trim().toUpperCase();

  // Direct mappings - exact matches
  const statusMap = {
    "DELIVERED": "Delivered",
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
    "PENDING": "Pending"
  };

  // Check for exact match first
  if (statusMap[reason]) {
    console.log(`[RTS Status] Mapped "${reasonValue}" → "${statusMap[reason]}" (exact match)`);
    return statusMap[reason];
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
    "PENDING": "Pending"
  };

  for (const [keyword, status] of Object.entries(partialMatches)) {
    if (reason.includes(keyword)) {
      console.log(`[RTS Status] Mapped "${reasonValue}" → "${status}" (partial match: ${keyword})`);
      return status;
    }
  }

  // No valid status found - log warning and default
  console.log(`[RTS Status] Warning: Unknown status value "${reasonValue}" - defaulting to "Unlocated"`);
  return "Unlocated";
}

// ==========================
// GET /deliveries
// Supports ?batchId= and/or ?status=
// ==========================
router.get("/", async (req, res) => {
  try {
    const batchId = req.query.batchId || null;
    const status = req.query.status || null;

    const filter = { record_type: 'card' };
    if (batchId) filter.import_batch_id = batchId;
    if (status) filter.status = status;

    // Always fetch deliveries from card record type (don't require batchId or status)
    const deliveries = await CardDelivery.find(filter).sort({ updated_at: -1 }).lean();

    const mappedDeliveries = deliveries.map((d) => ({ ...d, id: d._id.toString() }));

    return res.render("deliveries/deliveries", {
      deliveries: mappedDeliveries,
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
// ==========================
router.post("/import", upload.single("excel_file"), async (req, res) => {
  try {
    if (!req.file) return res.redirect("/deliveries");

    const batchId = crypto.randomUUID();
    const assignedPrinterId = (req.body.assigned_printer_id || "").trim() || null;

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = parseProgressiveReportRows(sheet);

    console.log("[Import] Parsed rows:", rows.length);
    console.log("[Import] Starting import process. Batch ID:", batchId);

    const docs = [];
    let invalidCount = 0;
    let duplicateCount = 0;
    let updatedCount = 0;
    let rowIndex = 0;

    for (const row of rows) {
      rowIndex++;
      if (!validateProgressiveRow(row)) {
        console.log(`[Import Row ${rowIndex}] Invalid row - skipped`);
        invalidCount++;
        continue;
      }

      const card_number = pickCardNumber(row);
      const recipient_name = String(row["NAME"] ?? "").trim();
      const address = buildAddress(row);
      const courier = String(row["PORT"] ?? "-").trim() || "-";
      const pickedStatus = pickStatus(row);
      const status = mapFileStatusToAppStatus(pickedStatus);

      console.log(`[Import Row ${rowIndex}] Card: ${card_number} | Recipient: ${recipient_name} | Picked Status: "${pickedStatus}" | Mapped Status: "${status}"`);

      // Normalize fields for matching (case-insensitive, trimmed)
      const normalizedCardNumber = card_number.toLowerCase().trim();
      const normalizedRecipientName = recipient_name.toLowerCase().trim();
      const normalizedAddress = address.toLowerCase().trim();

      // Escape special regex characters
      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Try to find existing delivery with normalized matching
      // Search all record types to catch existing records regardless of type
      console.log(`[Import Row ${rowIndex}] Searching DB for: "${normalizedCardNumber}" / "${normalizedRecipientName}" / "${normalizedAddress}"`);
      
      const existingDelivery = await CardDelivery.findOne({
        card_number: { $regex: `^${escapeRegex(normalizedCardNumber)}$`, $options: 'i' },
        recipient_name: { $regex: `^${escapeRegex(normalizedRecipientName)}$`, $options: 'i' },
        address: { $regex: `^${escapeRegex(normalizedAddress)}$`, $options: 'i' },
      }).lean();

      if (existingDelivery) {
        console.log(`[Import Row ${rowIndex}] ✓ FOUND existing record: ${existingDelivery._id} | Status: "${existingDelivery.status}"`);

        // Check if status has actually changed
        const statusChanged = status && status.trim() !== "" && existingDelivery.status !== status;
        console.log(`[Import Row ${rowIndex}] Status changed: ${statusChanged} (File: "${status}" vs DB: "${existingDelivery.status}")`);

        if (statusChanged) {
          console.log(
            `[Import Row ${rowIndex}] ⚡ UPDATING status: ${existingDelivery.status} → ${status}`
          );

          const updateResult = await CardDelivery.updateOne(
            { _id: existingDelivery._id },
            {
              $set: {
                status,
                updated_at: new Date(),
                import_batch_id: batchId,
                imported_by: req.user?._id?.toString() || req.user?.email || req.user?.name || "system",
                imported_at: new Date(),
                record_type: 'card',
              },
            }
          );

          updatedCount++;
          console.log(`[Import Row ${rowIndex}] ✓ UPDATED successfully. Modified count: ${updateResult.modifiedCount}`);

          await addAuditLog(req, {
            action_type: "UPDATE_DELIVERY_STATUS",
            entity_type: "CardDelivery",
            entity_id: existingDelivery._id.toString(),
            source: "Import (Status Update)",
            remarks: `Status updated via import for card **** **** **** ${last4(card_number)}: ${existingDelivery.status} → ${status}`,
            import_batch_id: batchId,
          });
        } else {
          console.log(`[Import Row ${rowIndex}] SKIP: No status change (File: "${status}" = DB: "${existingDelivery.status}")`);
          duplicateCount++;
        }
        continue;
      } else {
        console.log(`[Import Row ${rowIndex}] NOT FOUND - will create new record`);
      }

      docs.push({
        // Basic delivery fields
        card_number,
        recipient_name,
        address,
        courier,
        status,
        updated_at: new Date(),
        import_batch_id: batchId,
        imported_by: req.user?._id?.toString() || req.user?.email || req.user?.name || "system",
        imported_at: new Date(),
        assigned_printer: assignedPrinterId,
        record_type: 'card',
        
        // Progressive Report specific fields - map from Excel columns
        number: parseInt(row["NO."] || 0) || 0,
        name: String(row["NAME"] ?? "").trim(),
        pan: String(row["PAN"] ?? "").trim(),
        address1: String(row["ADDRESS1"] ?? "").trim(),
        address2: String(row["ADDRESS2"] ?? "").trim(),
        address3: String(row["ADDRESS3"] ?? "").trim(),
        address4: String(row["ADDRESS4"] ?? "").trim(),
        city: String(row["CITY"] ?? "").trim(),
        zipCode: String(row["ZIP CODE"] ?? "").trim(),
        mobileNo: String(row["MOBILE NO."] ?? "").trim(),
        product: String(row["PRODUCT"] ?? "").trim(),
        referenceNumber: String(row["REFERENCE NUMBER"] ?? "").trim(),
        fileName: String(row["FILE NAME"] ?? "").trim(),
        awbNumber: String(row["AWB NUMBER (Original)"] ?? "").trim(),
        port: String(row["PORT"] ?? "-").trim() || "-",
        receivedBy: String(row["RECEIVED BY"] ?? "").trim(),
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

    console.log("[Import] ═══════════════════════════════════════════");
    console.log(`[Import] SUMMARY - Batch: ${batchId}`);
    console.log(`[Import] ├─ Inserted: ${result.length} new records`);
    console.log(`[Import] ├─ Invalid: ${invalidCount} rows`);
    console.log(`[Import] ├─ Duplicates: ${duplicateCount} records (no status change)`);
    console.log(`[Import] └─ Updated: ${updatedCount} records (status changed)`);
    console.log("[Import] ═══════════════════════════════════════════");

    await addAuditLog(req, {
      action_type: "IMPORT_DELIVERIES",
      entity_type: "CardDelivery",
      entity_id: "BULK",
      source: "Deliveries Import",
      remarks: `Imported ${result.length} new deliveries. Skipped ${invalidCount} invalid rows, ${duplicateCount} duplicates, and updated ${updatedCount} existing entries with status changes.`,
      import_batch_id: batchId,
    });

    return res.redirect(`/deliveries?batchId=${encodeURIComponent(batchId)}`);
  } catch (err) {
    console.error("Error importing deliveries:", err);
    if (res.headersSent) return;
    return res.status(500).send("Error importing deliveries");
  }
});

router.post("/clear-session", async (req, res) => {
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

    // ==========================
    // NOTIFICATIONS (Ops + Admin)
    // ==========================
    const EXCEPTION_STATUSES = [
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
    ];

    //Delivery Exception / Failed Delivery (Ops + Admin) — “from exceptions page”
    if (EXCEPTION_STATUSES.includes(new_status) && new_status !== "Delivered") {
      const NEXT_STEP_BY_STATUS = {
        "Bad Address": "Verify address with customer / update records / schedule reattempt",
        "Consignee Not Around": "Contact customer / schedule delivery reattempt",
        "Denied Entry/Access": "Confirm access requirements / reschedule delivery",
        "Flooded Area": "Delay delivery and monitor conditions / reschedule later",
        "Office Close": "Confirm operating hours / reattempt next working day",
        "Relocated": "Verify new address / update delivery details",
        "Refuse to Accept": "Confirm refusal reason / escalate to issuer",
        "Transfer": "Track transfer process / confirm next handler",
        "Unlocated": "Verify location details / contact customer",
        "Return to Centre": "Confirm return handling / decide next action",
        "Return to Sender": "Notify sender / close delivery loop",
        "No Updates": "Investigate delivery progress / contact courier",
      };

    const recommendedNextStep =
      NEXT_STEP_BY_STATUS[new_status] || "Review exception and take appropriate action";


      await notifyRoles(["operations", "admin"], {
        category: "EXCEPTION_ALERT",
        severity: "warning",
        title: "Delivery exception / failed delivery",
        message: "A delivery moved into an exception status and requires follow-up.",
        data: {
          deliveryId: deliveryId,
          exceptionType: new_status,            // matches your system statuses
          reasonCode: "STATUS_EXCEPTION",
          shortNote: "Logged by status update",
          currentStatus: new_status,
          recommendedNextStep,
        },
        link_url: "/exceptions",
        dedupe_key: `EXC::${deliveryId}::${new_status}`,
      });
    }

    //Status Updated by Another Role (Ops)
    if (req.user?.role && req.user.role !== "operations") {
      await notifyRoles(["operations"], {
        category: "STATUS_ROLE_ALERT",
        severity: "info",
        title: "Status updated by another role",
        message: "A delivery status was updated by a non-operations role.",
        data: {
          deliveryId: deliveryId,
          oldStatus: oldStatus,
          newStatus: new_status,
          updatedByRole: req.user.role, // role only
        },
        link_url: "", // per your requirement
        dedupe_key: `ROLE_STATUS::${deliveryId}::${oldStatus}::${new_status}::${req.user.role}`,
      }, { dedupeMinutes: 5 });
    }


    // ================================
    // NOTIFY ADMIN: Sensitive field change
    // ================================
    try {
      const sensitiveFields = [
        "address",
        "postal",
        "zipcode",
        "zip",
        "unit",
        "block",
        "contact",
        "phone",
        "email",
      ];
    
      // 🔑 THIS MUST MATCH what you pass into addAuditLog
      const changedField = "status"; // OR req.body.fieldName if dynamic
    
      const isSensitive = sensitiveFields.some(k =>
        changedField.toLowerCase().includes(k)
      );
    
      if (isSensitive) {
        await notifyRoles(["admin"], {
          category: "SENSITIVE_FIELD_CHANGE",
          severity: "warning",
          title: "Sensitive field change",
          message: "A sensitive delivery field was edited.",
          data: {
            deliveryId,
            fieldChanged: changedField,
            changedBy: req.user?.role || "unknown",
          },
          link_url: `/auditLog?q=${encodeURIComponent(deliveryId)}`,
          dedupe_key: `ADMIN_SENSITIVE::${deliveryId}::${changedField}::${req.user?.role}`,
        }, { dedupeMinutes: 30 });
      }
    } catch (e) {
      console.error("Admin sensitive change notification failed:", e);
    }
    

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

// ==========================
// RTS (Return to Sender)
// ==========================
const RTS_REASON_MAP = {
  BAD: "Bad Address",
  CNA: "Consignee Not Around",
  DEN: "Denied Entry/Access",
  FLD: "Flooded Area",
  OFC: "Office Close",
  RCL: "Relocated",
  RTA: "Refuse to Accept",
  TRF: "Transfer",
  UCN: "Unlocated",
};

function mapRTSReasonToStatus(reason) {
  const normalized = toUpperTrim(reason);
  if (!normalized) return "";
  return RTS_REASON_MAP[normalized] || String(reason).trim();
}

function parseRTSReportRows(sheet) {
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  let headerRowIndex = -1;

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i].map(toUpperTrim);
    if (row.includes("CODE") && row.includes("RTS AWB") && row.includes("CNEE_NAME")) {
      headerRowIndex = i;
      console.log("[RTS Import Parser] Found RTS Report header at row", i);
      break;
    }
  }

  if (headerRowIndex === -1) {
    console.error("[RTS Import Parser] Could not find header row with CODE, RTS AWB, and CNEE_NAME");
    return [];
  }

  const headers = matrix[headerRowIndex].map((h) => String(h).trim().toUpperCase());
  console.log("[RTS Import Parser] Detected headers:", headers);
  console.log("[RTS Import Parser] Total columns:", headers.length);

  const out = [];
  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r];
    const hasAny = row.some((cell) => String(cell).trim() !== "");
    if (!hasAny) continue;

    const obj = {};
    // Store raw cell index for debugging
    for (let c = 0; c < row.length; c++) obj[c] = row[c];
    // Map headers to their values
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = row[c];
    }
    out.push(obj);
  }

  console.log(`[RTS Import Parser] Parsed ${out.length} data rows`);
  return out;
}

function validateRTSRow(row) {
  // Get CNEE_NAME (consignee name) - required
  const name = String(row["CNEE_NAME"] || row["SHPR_NAME"] || "").trim();
  if (!name) {
    console.log(`[RTS Validation] Rejected: Missing CNEE_NAME/SHPR_NAME`);
    return false;
  }

  // Reject if it's just the header text
  const nameUpper = toUpperTrim(name);
  if (nameUpper === "CNEE_NAME" || nameUpper === "SHPR_NAME") {
    console.log(`[RTS Validation] Rejected: Found header as data (${name})`);
    return false;
  }

  // Get street address - required
  const street = String(row["CNEE_STREET"] || "").trim();
  if (!street) {
    console.log(`[RTS Validation] Rejected: Missing CNEE_STREET`);
    return false;
  }

  // Reject if it's just the header text
  const streetUpper = toUpperTrim(street);
  if (streetUpper === "CNEE_STREET" || streetUpper === "ADDRESS") {
    console.log(`[RTS Validation] Rejected: Found header as data (${street})`);
    return false;
  }

  // Get AWB number - required for card number fallback
  const awb = String(row["RTS AWB"] || "").trim();
  if (!awb) {
    console.log(`[RTS Validation] Rejected: Missing RTS AWB`);
    return false;
  }

  // Reject if it's just the header text
  const awbUpper = toUpperTrim(awb);
  if (awbUpper === "RTS AWB" || awbUpper === "AWB") {
    console.log(`[RTS Validation] Rejected: Found header as data (${awb})`);
    return false;
  }

  // Validate status if present
  const reasonOrStatus = String(row["REASON"] || row["STATUS"] || "").trim();
  if (reasonOrStatus) {
    const validStatuses = [
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
      "Delivered",
      "Pending"
    ];

    // Check if any valid status keyword is in the value
    const hasValidKeyword = validStatuses.some(s => 
      reasonOrStatus.toLowerCase().includes(s.toLowerCase())
    );
    
    if (!hasValidKeyword) {
      console.log(`[RTS Validation] Warning: Unknown status "${reasonOrStatus}" - will default to "Unlocated"`);
    }
  }

  return true;
}

function buildRTSAddress(row) {
  // Build address from multiple possible columns
  const parts = [
    String(row["CNEE_STREET"] || "").trim(),
    String(row["CNEE_CITY"] || row["CITY"] || "").trim(),
    String(row["CNEE_ZIP"] || row["ZIPCODE"] || "").trim()
  ].filter(Boolean);

  if (parts.length === 0) {
    console.log(`[RTS Address] Warning: Could not build address from row`);
    return "";
  }

  const address = parts.join(", ");
  console.log(`[RTS Address] Built: ${address}`);
  return address;
}

function pickRTSCardNumber(row) {
  // Try CODE column first (should be the card number)
  const code = String(row["CODE"] || "").trim();
  if (code) {
    const cleanCode = cleanDigits(code);
    if (cleanCode.length === 16) {
      console.log(`[RTS Card] Found 16-digit card from CODE: ${cleanCode}`);
      return cleanCode;
    } else if (cleanCode.length > 0) {
      console.log(`[RTS Card] Found ${cleanCode.length}-digit from CODE: ${cleanCode}`);
      return cleanCode;
    }
  }

  // Fallback to RTS AWB if available
  const awb = String(row["RTS AWB"] || "").trim();
  if (awb) {
    const cleanAwb = cleanDigits(awb);
    if (cleanAwb.length > 0) {
      console.log(`[RTS Card] Using RTS AWB as fallback: ${awb}`);
      return awb;
    }
  }

  console.log(`[RTS Card] Warning: Could not extract card number from CODE or RTS AWB`);
  return "";
}

// GET /deliveries/rts
router.get("/rts", async (req, res) => {
  try {
    const batchId = req.query.batchId || null;
    const status = req.query.status || null;

    const RTS_STATUSES = [
      "Bad Address",
      "Consignee Not Around",
      "Denied Entry/Access",
      "Flooded Area",
      "Office Close",
      "Relocated",
      "Refuse to Accept",
      "Transfer",
      "Unlocated",
    ];

    const filter = { record_type: 'rts', status: { $in: RTS_STATUSES } };
    if (batchId) filter.import_batch_id = batchId;
    if (status) filter.status = status;

    let deliveries = [];
    if (batchId || status) {
      deliveries = await CardDelivery.find(filter).sort({ updated_at: -1 }).lean();
    } else {
      deliveries = await CardDelivery.find(filter).sort({ updated_at: -1 }).limit(100).lean();
    }

    deliveries = deliveries.map((d) => ({ ...d, id: d._id.toString() }));

    return res.render("deliveries/rts", {
      deliveries,
      batchId,
      selectedStatus: status,
    });
  } catch (err) {
    console.error("Error fetching RTS deliveries:", err);
    return res.status(500).send("Error loading RTS deliveries");
  }
});

// POST /deliveries/rts/import
router.post("/rts/import", upload.single("excel_file"), async (req, res) => {
  try {
    if (!req.file) return res.redirect("/deliveries/rts");

    const batchId = crypto.randomUUID();
    const assignedPrinterId = (req.body.assigned_printer_id || "").trim() || null;

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = parseRTSReportRows(sheet);

    console.log("[RTS Import] Parsed rows:", rows.length);

    const docs = [];
    let invalidCount = 0;
    let duplicateCount = 0;
    let updatedCount = 0;

    for (const row of rows) {
      if (!validateRTSRow(row)) {
        invalidCount++;
        continue;
      }

      const card_number = pickRTSCardNumber(row);
      if (!card_number) {
        console.log(`[RTS Import] Skipping row: Could not extract card number`);
        invalidCount++;
        continue;
      }

      const recipient_name = String(row["CNEE_NAME"] || row["SHPR_NAME"] || "").trim();
      if (!recipient_name) {
        console.log(`[RTS Import] Skipping row: No recipient name`);
        invalidCount++;
        continue;
      }

      const address = buildRTSAddress(row);
      if (!address) {
        console.log(`[RTS Import] Skipping row: Could not build address`);
        invalidCount++;
        continue;
      }

      const courier = String(row["DEST_PORT"] || "-").trim() || "-";

      // Get the status from REASON column - use improved mapping
      let rawReason = String(row["REASON"] || row["STATUS"] || row[14] || "").trim();
      let status = mapRTSReasonToStatus(rawReason);
      
      console.log(`[RTS Import] Row: ${card_number} | Recipient: ${recipient_name} | Status: "${status}" | Raw: "${rawReason}"`);

      const existingDelivery = await CardDelivery.findOne({
        card_number,
        recipient_name,
        address,
      }).lean();

      if (existingDelivery) {
        if (status && existingDelivery.status !== status) {
          console.log(`[RTS Import] Status change: ${card_number} (${existingDelivery.status} → ${status})`);

          await CardDelivery.updateOne(
            { _id: existingDelivery._id },
            {
              $set: {
                status,
                updated_at: new Date(),
                import_batch_id: batchId,
                imported_by: req.user?._id?.toString() || req.user?.email || req.user?.name || "system",
                imported_at: new Date(),
                record_type: 'rts',

                // RTS extra fields (only if your schema has them; harmless otherwise)
                ship_name: String(row["SHPR_NAME"] || "").trim(),
                pickup_date: String(row["PICKUP_DATE"] || "").trim(),
                code: String(row["CODE"] || "").trim(),
                rts_awb: String(row["RTS AWB"] || "").trim(),
                cnee_zip: String(row["CNEE_ZIP"] || "").trim(),
                dest_port: String(row["DEST_PORT"] || "").trim(),
                cnee_name: String(row["CNEE_NAME"] || "").trim(),
                cnee_street: String(row["CNEE_STREET"] || "").trim(),
                date_received: String(row["DATE_RECEIVED"] || "").trim(),
                reason: rawReason,
                remarks: String(row["REMARKS"] || "").trim(),
                cnee_contact_no: String(row["CNEE_CONTACT_NO"] || "").trim(),
                reference: String(row["REFERENCE"] || "").trim(),
                attachment: String(row["ATTACHMENT"] || "").trim(),
                new_attachment: String(row["NEW_ATTACHMENT"] || "").trim(),
              },
            }
          );

          updatedCount++;

          await addAuditLog(req, {
            action_type: "UPDATE_DELIVERY_STATUS",
            entity_type: "CardDelivery",
            entity_id: existingDelivery._id.toString(),
            source: "RTS Import (Status Update)",
            remarks: `RTS status updated: ${existingDelivery.status} → ${status}`,
            import_batch_id: batchId,
          });
        } else {
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
        assigned_printer: assignedPrinterId,
        record_type: 'rts',

        // RTS extra fields (only if your schema has them; harmless otherwise)
        ship_name: String(row["SHPR_NAME"] || "").trim(),
        pickup_date: String(row["PICKUP_DATE"] || "").trim(),
        code: String(row["CODE"] || "").trim(),
        rts_awb: String(row["RTS AWB"] || "").trim(),
        cnee_zip: String(row["CNEE_ZIP"] || "").trim(),
        dest_port: String(row["DEST_PORT"] || "").trim(),
        cnee_name: String(row["CNEE_NAME"] || "").trim(),
        cnee_street: String(row["CNEE_STREET"] || "").trim(),
        date_received: String(row["DATE_RECEIVED"] || "").trim(),
        reason: rawReason,
        remarks: String(row["REMARKS"] || "").trim(),
        cnee_contact_no: String(row["CNEE_CONTACT_NO"] || "").trim(),
        reference: String(row["REFERENCE"] || "").trim(),
        attachment: String(row["ATTACHMENT"] || "").trim(),
        new_attachment: String(row["NEW_ATTACHMENT"] || "").trim(),
      });
    }

    if (docs.length === 0 && updatedCount === 0) {
      console.warn("[RTS Import] No valid rows found in file");
      return res.redirect("/deliveries/rts");
    }

    let result = [];
    if (docs.length > 0) result = await CardDelivery.insertMany(docs);

    console.log(
      `[RTS Import] Inserted ${result.length}. Invalid: ${invalidCount}. Duplicates: ${duplicateCount}. Updated: ${updatedCount}`
    );

    await addAuditLog(req, {
      action_type: "IMPORT_RTS_DELIVERIES",
      entity_type: "CardDelivery",
      entity_id: "BULK",
      source: "RTS Import",
      remarks: `Imported ${result.length} RTS deliveries. Skipped ${invalidCount} invalid, ${duplicateCount} duplicates, updated ${updatedCount} existing.`,
      import_batch_id: batchId,
    });

    return res.redirect(`/deliveries/rts?batchId=${encodeURIComponent(batchId)}`);
  } catch (err) {
    console.error("Error importing RTS deliveries:", err);
    if (res.headersSent) return;
    return res.status(500).send("Error importing RTS deliveries");
  }
});

// POST /deliveries/rts/clear-session
router.post("/rts/clear-session", async (req, res) => {
  res.clearCookie("last_rts_import_batch");
  return res.redirect("/deliveries/rts");
});

// ==========================
// GET /deliveries/export
// ==========================
router.get("/export", async (req, res) => {
  try {
    const batchId = req.query.batchId || null;
    const status = req.query.status || null;

    const filter = {};
    if (batchId) filter.import_batch_id = batchId;
    if (status) filter.status = status;

    const deliveries = await CardDelivery.find(filter).sort({ updated_at: -1 }).lean();
    if (deliveries.length === 0) return res.status(400).send("No data to export");

    const exportData = deliveries.map((d) => ({
      ID: d._id.toString(),
      "Card / Ref #": d.card_number,
      Recipient: d.recipient_name,
      Address: d.address,
      Courier: d.courier || "-",
      Status: d.status,
      "Updated At": d.updated_at ? new Date(d.updated_at).toISOString() : "-",
    }));

    const ws = xlsx.utils.json_to_sheet(exportData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Deliveries");

    const fileName = `deliveries_${Date.now()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(xlsx.write(wb, { type: "buffer" }));
  } catch (err) {
    console.error("Error exporting deliveries:", err);
    return res.status(500).send("Error exporting deliveries");
  }
});

// ==========================
// GET /deliveries/rts/export
// ==========================
router.get("/rts/export", async (req, res) => {
  try {
    const batchId = req.query.batchId || null;
    const status = req.query.status || null;

    const RTS_STATUSES = [
      "Bad Address",
      "Consignee Not Around",
      "Denied Entry/Access",
      "Flooded Area",
      "Office Close",
      "Relocated",
      "Refuse to Accept",
      "Transfer",
      "Unlocated",
    ];

    const filter = { status: { $in: RTS_STATUSES } };
    if (batchId) filter.import_batch_id = batchId;
    if (status) filter.status = status;

    const deliveries = await CardDelivery.find(filter).sort({ updated_at: -1 }).lean();
    if (deliveries.length === 0) return res.status(400).send("No RTS data to export");

    const exportData = deliveries.map((d) => ({
      NO: "",
      SHPR_NAME: d.ship_name || "",
      PICKUP_DATE: d.pickup_date || "",
      CODE: d.code || "",
      RTS_AWB: d.rts_awb || "",
      CNEE_ZIP: d.cnee_zip || "",
      DEST_PORT: d.dest_port || "",
      CNEE_NAME: d.cnee_name || "",
      CNEE_STREET: d.cnee_street || "",
      DATE_RECEIVED: d.date_received || "",
      REASON: d.reason || "",
      REMARKS: d.remarks || "",
      CNEE_CONTACT_NO: d.cnee_contact_no || "",
      REFERENCE: d.reference || "",
      ATTACHMENT: d.attachment || "",
      NEW_ATTACHMENT: d.new_attachment || "",
      Status: d.status,
      Updated_At: d.updated_at ? new Date(d.updated_at).toISOString() : "-",
    }));

    const ws = xlsx.utils.json_to_sheet(exportData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "RTS");

    const fileName = `rts_${Date.now()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(xlsx.write(wb, { type: "buffer" }));
  } catch (err) {
    console.error("Error exporting RTS data:", err);
    return res.status(500).send("Error exporting RTS data");
  }
});

// ==========================
// Dispatch List (inside /deliveries)
// GET /deliveries/dispatchlist
// GET /deliveries/dispatchlist
// ==========================
router.get("/dispatchlist", async (req, res) => {
  try {
    const batchId = req.query.batchId || req.query.batch || null;
    let dispatches = [];

    if (batchId) {
      dispatches = await CardDelivery.find({ import_batch_id: batchId, record_type: 'dispatch' }).sort({ created_at: -1 }).lean();
    } else {
      dispatches = await CardDelivery.find({ record_type: 'dispatch' }).sort({ imported_at: -1 }).limit(100).lean();
    }

    dispatches = dispatches.map(d => ({ ...d, id: d._id.toString() }));
    console.log("[Dispatch List GET] batchId:", batchId, "dispatches count:", dispatches.length);
    return res.render("deliveries/dispatchList", { dispatches, batchId });
  } catch (err) {
    console.error("Error fetching dispatch list:", err);
    return res.status(500).send("Error loading dispatch list");
  }
});

router.post("/dispatchlist/clear-session", (req, res) => {
  return res.redirect("/deliveries/dispatchlist");
});

router.post("/dispatchlist/import", upload.single("excel_file"), async (req, res) => {
  try {
    console.log("[Dispatch Import] Starting import, file:", req.file?.originalname);
    if (!req.file) {
      console.error("[Dispatch Import] No file uploaded");
      return res.status(400).send("No file uploaded.");
    }

    console.log("[Dispatch Import] Reading file:", req.file.path);
    const wb = xlsx.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    
    // Read the sheet as 2D array to handle multi-row headers
    const matrix = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
    
    console.log("[Dispatch Import] Matrix rows:", matrix.length);
    console.log("[Dispatch Import] First few rows:");
    for (let i = 0; i < Math.min(3, matrix.length); i++) {
      console.log(`  Row ${i}:`, matrix[i].slice(0, 5));
    }

    let headerRowIndex = -1;
    let dataStartIndex = 0;

    // Find the header row - look for a row that contains column names
    for (let i = 0; i < Math.min(5, matrix.length); i++) {
      const row = matrix[i].map(cell => String(cell || "").trim().toUpperCase());
      console.log(`[Dispatch Import] Row ${i} check:`, row.includes("NO"), row.includes("NAME"), row.includes("PAN"));
      
      if (row.includes("NO") || row.includes("NAME") || row.includes("PAN")) {
        headerRowIndex = i;
        dataStartIndex = i + 1;
        console.log("[Dispatch Import] Found header row at index:", i);
        break;
      }
    }

    if (headerRowIndex === -1) {
      console.error("[Dispatch Import] Could not find header row");
      return res.status(400).send("Could not find header row in Excel file. Expected columns: NO, NAME, PAN, ADDRESS1, etc.");
    }

    const headerRow = matrix[headerRowIndex].map(cell => String(cell || "").trim());
    const dataRows = matrix.slice(dataStartIndex);

    console.log("[Dispatch Import] Header row:", headerRow.slice(0, 5));
    console.log("[Dispatch Import] Data rows found:", dataRows.length);

    const mapped = dataRows
      .map((row, idx) => {
        // Create object mapping headers to values
        const obj = {};
        for (let i = 0; i < headerRow.length; i++) {
          const header = normKey(headerRow[i]);
          obj[header] = row[i] || "";
        }

        const result = {
          no: obj["NO"] || (idx + 1),
          name: obj["NAME"] || "",
          pan: obj["PAN"] || "",
          address1: obj["ADDRESS1"] || "",
          address2: obj["ADDRESS2"] || "",
          address3: obj["ADDRESS3"] || "",
          address4: obj["ADDRESS4"] || "",
          city: obj["CITY"] || "",
          state: obj["STATE"] || "",
          country: obj["COUNTRY"] || "",
          zipCode: obj["ZIP CODE"] || obj["ZIPCODE"] || "",
          mobileNo: obj["MOBILE NO"] || obj["MOBILE NO."] || "",
          product: obj["PRODUCT"] || "",
          referenceNumber: obj["REFERENCE NUMBER"] || "",
          fileName: obj["FILE NAME"] || "",
          awbNumber: obj["AWB NUMBER"] || "",
          dispatchDate: parseDate(obj["DISPATCH DATE"]),
        };

        if (idx === 0) {
          console.log("[Dispatch Import] First mapped row:", result);
        }

        return result;
      });

    console.log("[Dispatch Import] Mapped rows:", mapped.length);

    const batchId = String(Date.now());
    const importedBy = req.user?._id?.toString() || req.user?.email || req.user?.name || "system";

    console.log("[Dispatch Import] Batch ID:", batchId, "Imported by:", importedBy);

    const docs = [];
    let duplicateCount = 0;
    let updatedCount = 0;

    console.log("[Dispatch Import] Starting duplicate check loop for", mapped.length, "rows");

    for (let idx = 0; idx < mapped.length; idx++) {
      const m = mapped[idx];
      
      console.log(`[Dispatch Import] Row ${idx} - Checking duplicates:`, {
        referenceNumber: m.referenceNumber,
        fileName: m.fileName,
        name: m.name,
        address1: m.address1
      });
      
      // Check for duplicates based on available unique identifiers
      let existingRecord = null;
      
      // Prefer checking by referenceNumber if available
      if (m.referenceNumber && String(m.referenceNumber).trim()) {
        console.log(`[Dispatch Import] Row ${idx} - Checking by referenceNumber: "${m.referenceNumber}"`);
        existingRecord = await CardDelivery.findOne({
          record_type: "dispatch",
          referenceNumber: m.referenceNumber,
        }).lean();
        if (existingRecord) {
          console.log(`[Dispatch Import] Row ${idx} - Found duplicate by referenceNumber`);
        }
      }
      
      // If not found and fileName is available, check by fileName
      if (!existingRecord && m.fileName && String(m.fileName).trim()) {
        console.log(`[Dispatch Import] Row ${idx} - Checking by fileName: "${m.fileName}"`);
        existingRecord = await CardDelivery.findOne({
          record_type: "dispatch",
          fileName: m.fileName,
        }).lean();
        if (existingRecord) {
          console.log(`[Dispatch Import] Row ${idx} - Found duplicate by fileName`);
        }
      }
      
      // As last resort, check by name and address combination (dispatch list specific)
      if (!existingRecord && m.name && String(m.name).trim() && m.address1 && String(m.address1).trim()) {
        console.log(`[Dispatch Import] Row ${idx} - Checking by name & address1: "${m.name}" + "${m.address1}"`);
        existingRecord = await CardDelivery.findOne({
          record_type: "dispatch",
          name: m.name,
          address1: m.address1,
        }).lean();
        if (existingRecord) {
          console.log(`[Dispatch Import] Row ${idx} - Found duplicate by name & address1`);
        }
      }

      if (existingRecord) {
        // Record already exists, check if status changed
        console.log(`[Dispatch Import] Row ${idx} - Found existing record: ${existingRecord._id}`);
        console.log(`[Dispatch Import] Row ${idx} - Current status: "${existingRecord.status}" | New status: "${m.status}"`);
        
        // Check if status has changed
        const statusChanged = m.status && m.status.trim() !== "" && existingRecord.status !== m.status;
        
        if (statusChanged) {
          console.log(`[Dispatch Import] Row ${idx} - STATUS CHANGED: "${existingRecord.status}" → "${m.status}"`);
          
          await CardDelivery.updateOne(
            { _id: existingRecord._id },
            {
              $set: {
                status: m.status,
                import_batch_id: batchId,
                imported_by: importedBy,
                imported_at: new Date(),
              },
            }
          );
          
          console.log(`[Dispatch Import] Row ${idx} - ✓ Status updated successfully`);
          updatedCount++;
        } else {
          // No status change, just update batch ID so it shows in current import session
          console.log(`[Dispatch Import] Row ${idx} - No status change, updating batch ID only`);
          
          await CardDelivery.updateOne(
            { _id: existingRecord._id },
            {
              $set: {
                import_batch_id: batchId,
                imported_by: importedBy,
                imported_at: new Date(),
              },
            }
          );
          
          updatedCount++;
        }
        continue;
      }
      
      console.log(`[Dispatch Import] Row ${idx} - No duplicate found, will insert`);

      // Add record_type and batch info
      const recordWithType = { 
        ...m, 
        record_type: 'dispatch', 
        import_batch_id: batchId, 
        imported_by: importedBy, 
        imported_at: new Date() 
      };

      docs.push(recordWithType);
    }

    console.log("[Dispatch Import] Documents to insert:", docs.length, "Duplicates skipped:", duplicateCount);
    if (docs.length > 0) {
      console.log("[Dispatch Import] First doc:", docs[0]);
    }

    let savedCount = 0;

    // Insert all documents directly
    if (docs.length > 0) {
      try {
        const result = await CardDelivery.insertMany(docs, { ordered: false });
        savedCount = result.length;
        console.log("[Dispatch Import] insertMany successful. Inserted:", savedCount);
      } catch (dbErr) {
        console.error("[Dispatch Import] insertMany error:", dbErr.message);
        console.error("[Dispatch Import] Full error:", dbErr);
        return res.status(500).send("Failed to save dispatch list to database: " + dbErr.message);
      }
    } else {
      console.warn("[Dispatch Import] No new documents to insert");
    }

    if (savedCount === 0 && updatedCount === 0) {
      console.warn("[Dispatch Import] No records were saved");
      return res.status(400).send("No valid records to import");
    }

    await addAuditLog(req, {
      action_type: "IMPORT_DISPATCH_LIST",
      entity_type: "DispatchList",
      entity_id: "BULK",
      source: "Dispatch List Import",
      remarks: `Imported ${savedCount} dispatch list records`,
      import_batch_id: batchId,
    });

    console.log("[Dispatch Import] Redirecting to:", `/deliveries/dispatchlist?batchId=${batchId}`);
    return res.redirect(`/deliveries/dispatchlist?batchId=${encodeURIComponent(batchId)}`);
  } catch (err) {
    console.error("[Dispatch Import] Caught error:", err);
    return res.status(500).send("Failed to import dispatch list: " + err.message);
  }
});


// GET /deliveries/dispatchlist/export
router.get("/dispatchlist/export", async (req, res) => {
  try {
    const batchId = req.query.batchId || null;
    const status = req.query.status || null;

    const filter = { record_type: 'dispatch' };
    if (batchId) filter.import_batch_id = batchId;
    if (status) filter.status = status;

    const dispatches = await CardDelivery.find(filter).sort({ created_at: -1 }).lean();
    if (dispatches.length === 0) return res.status(400).send("No dispatch list data to export");

    const exportData = dispatches.map((d) => ({
      NO: d.no || "",
      NAME: d.name || "",
      PAN: d.pan || "",
      ADDRESS1: d.address1 || "",
      ADDRESS2: d.address2 || "",
      ADDRESS3: d.address3 || "",
      ADDRESS4: d.address4 || "",
      CITY: d.city || "",
      STATE: d.state || "",
      COUNTRY: d.country || "",
      "ZIP CODE": d.zipCode || "",
      "MOBILE NO": d.mobileNo || "",
      PRODUCT: d.product || "",
      "REFERENCE NUMBER": d.referenceNumber || "",
      "FILE NAME": d.fileName || "",
      "AWB NUMBER": d.awbNumber || "",
      "DISPATCH DATE": d.dispatchDate ? new Date(d.dispatchDate).toLocaleDateString() : "",
      STATUS: d.status || "",
      Updated_At: d.updated_at ? new Date(d.updated_at).toISOString() : "-",
    }));

    const ws = xlsx.utils.json_to_sheet(exportData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Dispatch");

    const fileName = `dispatch_list_${Date.now()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(xlsx.write(wb, { type: "buffer" }));
  } catch (err) {
    console.error("Error exporting dispatch list data:", err);
    return res.status(500).send("Error exporting dispatch list data");
  }
});

// ==========================
// Progressive Reports (inside /deliveries)
// GET /deliveries/progressivereports
// GET /deliveries/progressivereports
// ==========================
router.get("/progressivereports", async (req, res) => {
  try {
    const batchId = req.query.batchId || req.query.batch || null;
    let reports = [];

    if (batchId) {
      reports = await CardDelivery.find({ import_batch_id: batchId, record_type: 'progressive' }).sort({ created_at: -1 }).lean();
    } else {
      reports = await CardDelivery.find({ record_type: 'progressive' }).sort({ imported_at: -1 }).limit(100).lean();
    }

    reports = reports.map(r => ({ ...r, id: r._id.toString() }));
    console.log("[Progressive Report GET] batchId:", batchId, "reports count:", reports.length);
    return res.render("deliveries/progressiveReport", { reports, batchId });
  } catch (err) {
    console.error("Error fetching progressive reports:", err);
    return res.status(500).send("Error loading progressive reports");
  }
});

router.post("/progressivereports/clear-session", (req, res) => {
  return res.redirect("/deliveries/progressivereports");
});

router.post("/progressivereports/import", upload.single("excel_file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No file uploaded.");

    const wb = xlsx.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    
    // Read the sheet as 2D array to handle multi-row headers
    const matrix = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
    
    console.log("[Progressive Import] Matrix rows:", matrix.length);
    console.log("[Progressive Import] First row:", matrix[0]);
    console.log("[Progressive Import] Second row (potential headers):", matrix[1]);

    let headerRowIndex = -1;
    let dataStartIndex = 0;

    // Find the header row - look for a row that contains column names like NUMBER, NAME, PAN, etc.
    for (let i = 0; i < Math.min(5, matrix.length); i++) {
      const row = matrix[i].map(cell => String(cell || "").trim().toUpperCase());
      if (row.includes("NUMBER") || row.includes("NO") || row.includes("NAME")) {
        headerRowIndex = i;
        dataStartIndex = i + 1;
        console.log("[Progressive Import] Found header row at index:", i);
        break;
      }
    }

    if (headerRowIndex === -1) {
      return res.status(400).send("Could not find header row in Excel file. Expected columns: NUMBER, NAME, PAN, ADDRESS1, etc.");
    }

    const headerRow = matrix[headerRowIndex].map(cell => String(cell || "").trim());
    const dataRows = matrix.slice(dataStartIndex);

    console.log("[Progressive Import] Headers:", headerRow);
    console.log("[Progressive Import] Data rows:", dataRows.length);
    if (dataRows.length > 0) {
      console.log("[Progressive Import] First data row:", dataRows[0]);
    }

    const mapped = dataRows
      .map((row, idx) => {
        // Create object mapping headers to values
        const obj = {};
        for (let i = 0; i < headerRow.length; i++) {
          const header = normKey(headerRow[i]);
          obj[header] = row[i] || "";
        }

        console.log(`[Progressive Import] Row ${idx} normalized keys:`, Object.keys(obj).slice(0, 5), "...");

        const result = {
          number: obj["NUMBER"] || obj["NO"] || (idx + 1),
          name: obj["NAME"] || "",
          pan: obj["PAN"] || "",
          address1: obj["ADDRESS1"] || "",
          address2: obj["ADDRESS2"] || "",
          address3: obj["ADDRESS3"] || "",
          address4: obj["ADDRESS4"] || "",
          zipCode: obj["ZIPCODE"] || obj["ZIP CODE"] || "",
          mobileNo: obj["MOBILE NO"] || obj["MOBILE NO."] || "",
          product: obj["PRODUCT"] || "",
          referenceNumber: obj["REFERENCE NUMBER"] || "",
          fileName: obj["FILE NAME"] || "",
          awbNumber: obj["AWB NUMBER"] || "",
          dispatchDate: parseDate(obj["DISPATCH DATE"]),
          receivedBy: obj["RECEIVED BY"] || "",
          receivedDate: parseDate(obj["RECEIVED DATE"]),
          status: String(obj["STATUS"] || "").trim(),
          remarks: obj["REMARKS"] || "",
          port: obj["PORT"] || "",
        };

        if (idx === 0) {
          console.log(`[Progressive Import] First data row mapped:`, result);
        }

        return result;
      });

    console.log("[Progressive Import] Mapped rows:", mapped.length);
    if (mapped.length > 0) {
      console.log("[Progressive Import] First mapped row:", mapped[0]);
    }

    const batchId = String(Date.now());
    const importedBy = req.user?._id?.toString() || req.user?.email || req.user?.name || "system";

    const docs = [];
    let duplicateCount = 0;
    let updatedCount = 0;

    console.log("[Progressive Import] Starting duplicate check loop for", mapped.length, "rows");

    for (let idx = 0; idx < mapped.length; idx++) {
      const m = mapped[idx];
      
      console.log(`[Progressive Import] Row ${idx} - Checking duplicates:`, {
        referenceNumber: m.referenceNumber,
        fileName: m.fileName,
        name: m.name,
        address1: m.address1
      });
      
      // Check for duplicates based on available unique identifiers
      let existingRecord = null;
      
      // Prefer checking by referenceNumber if available
      if (m.referenceNumber && String(m.referenceNumber).trim()) {
        console.log(`[Progressive Import] Row ${idx} - Checking by referenceNumber: "${m.referenceNumber}"`);
        existingRecord = await CardDelivery.findOne({
          record_type: "progressive",
          referenceNumber: m.referenceNumber,
        }).lean();
        if (existingRecord) {
          console.log(`[Progressive Import] Row ${idx} - Found duplicate by referenceNumber`);
        }
      }
      
      // If not found and fileName is available, check by fileName
      if (!existingRecord && m.fileName && String(m.fileName).trim()) {
        console.log(`[Progressive Import] Row ${idx} - Checking by fileName: "${m.fileName}"`);
        existingRecord = await CardDelivery.findOne({
          record_type: "progressive",
          fileName: m.fileName,
        }).lean();
        if (existingRecord) {
          console.log(`[Progressive Import] Row ${idx} - Found duplicate by fileName`);
        }
      }
      
      // As last resort, check by name and address combination (progressive report specific)
      if (!existingRecord && m.name && String(m.name).trim() && m.address1 && String(m.address1).trim()) {
        console.log(`[Progressive Import] Row ${idx} - Checking by name & address1: "${m.name}" + "${m.address1}"`);
        existingRecord = await CardDelivery.findOne({
          record_type: "progressive",
          name: m.name,
          address1: m.address1,
        }).lean();
        if (existingRecord) {
          console.log(`[Progressive Import] Row ${idx} - Found duplicate by name & address1`);
        }
      }

      if (existingRecord) {
        // Record already exists, check if status changed
        console.log(`[Progressive Import] Row ${idx} - Found existing record: ${existingRecord._id}`);
        console.log(`[Progressive Import] Row ${idx} - Current status: "${existingRecord.status}" | New status: "${m.status}"`);
        
        // Check if status has changed
        const statusChanged = m.status && m.status.trim() !== "" && existingRecord.status !== m.status;
        
        if (statusChanged) {
          console.log(`[Progressive Import] Row ${idx} -  STATUS CHANGED: "${existingRecord.status}" → "${m.status}"`);
          
          await CardDelivery.updateOne(
            { _id: existingRecord._id },
            {
              $set: {
                status: m.status,
                import_batch_id: batchId,
                imported_by: importedBy,
                imported_at: new Date(),
              },
            }
          );
          
          console.log(`[Progressive Import] Row ${idx} - ✓ Status updated successfully`);
          updatedCount++;
        } else {
          // No status change, just update batch ID so it shows in current import session
          console.log(`[Progressive Import] Row ${idx} - No status change, updating batch ID only`);
          
          await CardDelivery.updateOne(
            { _id: existingRecord._id },
            {
              $set: {
                import_batch_id: batchId,
                imported_by: importedBy,
                imported_at: new Date(),
              },
            }
          );
          
          updatedCount++;
        }
        continue;
      }
      
      console.log(`[Progressive Import] Row ${idx} - No duplicate found, will insert`);

      // Add record_type and batch info
      const recordWithType = { 
        ...m, 
        record_type: 'progressive', 
        import_batch_id: batchId, 
        imported_by: importedBy, 
        imported_at: new Date() 
      };

      docs.push(recordWithType);
    }

    console.log("[Progressive Import] Documents to insert:", docs.length, "Duplicates skipped:", duplicateCount);
    if (docs.length > 0) {
      console.log("[Progressive Import] First doc:", docs[0]);
    }

    let savedCount = 0;

    // Insert all documents directly
    if (docs.length > 0) {
      try {
        const result = await CardDelivery.insertMany(docs, { ordered: false });
        savedCount = result.length;
        console.log("[Progressive Import] insertMany successful. Inserted:", savedCount);
      } catch (dbErr) {
        console.error("[Progressive Import] insertMany error:", dbErr.message);
        return res.status(500).send("Failed to save progressive report to database: " + dbErr.message);
      }
    }

    if (savedCount === 0 && updatedCount === 0) {
      console.warn("[Progressive Import] No records were saved");
      return res.status(400).send("No valid records to import");
    }

    await addAuditLog(req, {
      action_type: "IMPORT_PROGRESSIVE_REPORT",
      entity_type: "ProgressiveReport",
      entity_id: "BULK",
      source: "Progressive Report Import",
      remarks: `Imported ${savedCount} progressive report records`,
      import_batch_id: batchId,
    });

    console.log("[Progressive Import] Redirecting to batch:", batchId);
    return res.redirect(`/deliveries/progressivereports?batch=${encodeURIComponent(batchId)}`);
  } catch (err) {
    console.error("Progressive import error:", err);
    return res.status(500).send("Failed to import progressive report.");
  }
});

// GET /deliveries/progressivereports/export
router.get("/progressivereports/export", async (req, res) => {
  try {
    const batchId = req.query.batchId || null;
    const status = req.query.status || null;

    const filter = { record_type: 'progressive' };
    if (batchId) filter.import_batch_id = batchId;
    if (status) filter.status = status;

    const reports = await CardDelivery.find(filter).sort({ created_at: -1 }).lean();
    if (reports.length === 0) return res.status(400).send("No progressive report data to export");

    const exportData = reports.map((r) => ({
      NO: r.number || "",
      NAME: r.name || "",
      PAN: r.pan || "",
      ADDRESS1: r.address1 || "",
      ADDRESS2: r.address2 || "",
      ADDRESS3: r.address3 || "",
      ADDRESS4: r.address4 || "",
      CITY: r.city || "",
      STATE: r.state || "",
      COUNTRY: r.country || "",
      ZIPCODE: r.zipCode || "",
      "MOBILE NO": r.mobileNo || "",
      PRODUCT: r.product || "",
      "REFERENCE NUMBER": r.referenceNumber || "",
      "FILE NAME": r.fileName || "",
      "AWB NUMBER": r.awbNumber || "",
      "DISPATCH DATE": r.dispatchDate ? new Date(r.dispatchDate).toLocaleDateString() : "",
      "RECEIVED BY": r.receivedBy || "",
      "RECEIVED DATE": r.receivedDate ? new Date(r.receivedDate).toLocaleDateString() : "",
      PORT: r.port || "",
      STATUS: r.status || "",
      REMARKS: r.remarks || "",
      Updated_At: r.updated_at ? new Date(r.updated_at).toISOString() : "-",
    }));

    const ws = xlsx.utils.json_to_sheet(exportData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Progressive");

    const fileName = `progressive_report_${Date.now()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(xlsx.write(wb, { type: "buffer" }));
  } catch (err) {
    console.error("Error exporting progressive report data:", err);
    return res.status(500).send("Error exporting progressive report data");
  }
});

module.exports = router;
