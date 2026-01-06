// routes/deliveryRouter.js
const express = require("express");
const router = express.Router();

const crypto = require("crypto"); // ✅ needed for randomUUID()
const { addAuditLog } = require("../utils/audit");

const CardDelivery = require("../models/CardDelivery");

const multer = require("multer");
const xlsx = require("xlsx");
const { body, validationResult } = require("express-validator");

// Multer: temporary upload folder
const upload = multer({ dest: 'uploads/' });

console.log('[deliveryRouter] loaded');

// Helper: mask card for logs (PDPA – only last 4 digits)
function last4(card) {
  if (!card) return '****';
  const clean = String(card).replace(/\s+/g, '');
  return clean.slice(-4);
}


// Reusable validation rules for a single delivery (FR24)
const deliveryValidationRules = [
  body('card_number')
    .trim()
    .matches(/^\d{16}$/)
    .withMessage('Card number must be 16 digits'),
  body('recipient_name')
    .trim()
    .notEmpty()
    .withMessage('Recipient name is required')
    .isLength({ max: 100 })
    .withMessage('Recipient name too long'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('courier')
    .optional({ checkFalsy: true })
    .isLength({ max: 50 })
    .withMessage('Courier name too long'),
  body('status')
    .optional()
    .isIn(['Pending', 'Shipped', 'Delivered', 'Failed'])
    .withMessage('Invalid status value'),
];


function toUpperTrim(v) {
  return String(v ?? '').trim().toUpperCase();
}

function cleanDigits(v) {
  return String(v ?? '').replace(/\D+/g, '');
}

/**
 * Reads the sheet as a 2D array, finds the header row and return objects.
 */
function parseProgressiveReportRows(sheet) {
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Find the best header row
  let headerRowIndex = -1;

  // Prefer the row that contains "REFERENCE NUMBER"
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i].map(toUpperTrim);
    if (row.includes('REFERENCE NUMBER') && row.includes('NAME') && row.includes('ADDRESS1')) {
      headerRowIndex = i;
      break;
    }
  }

  // Fallback: any row with NAME + ADDRESS1
  if (headerRowIndex === -1) {
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i].map(toUpperTrim);
      if (row.includes('NAME') && row.includes('ADDRESS1')) {
        headerRowIndex = i;
        break;
      }
    }
  }

  if (headerRowIndex === -1) return [];

  const headers = matrix[headerRowIndex].map(h => String(h).trim());
  const out = [];

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r];

    // Skip fully empty rows
    const hasAny = row.some(cell => String(cell).trim() !== '');
    if (!hasAny) continue;

    // Build object
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue; // skip empty header cells
      obj[key] = row[c];
    }

    out.push(obj);
  }

  return out;
}

/**
 * Must have name
 * Must have at least one address field (ADDRESS1-ADDRESS4/ CITY/ ZIPCODE)
 * Must have an identifier we can store as card_number
 */
function validateProgressiveRow(row) {
  const name = String(row['NAME'] ?? '').trim();
  const nameUpper = toUpperTrim(name);

  // reject obvious header rows
  if (!name) return false;
  if (nameUpper === 'NAME' || nameUpper === 'SHPR_NAME') return false;

  const addressParts = [
    row['ADDRESS1'],
    row['ADDRESS2'],
    row['ADDRESS3'],
    row['ADDRESS4'],
    row['CITY'],
    row['ZIPCODE'],
  ].map(v => String(v ?? '').trim()).filter(Boolean);

  if (addressParts.length === 0) return false;

  // reject "address header" rows like: "ADDRESS1, ADDRESS2, ..."
  const addressJoinedUpper = toUpperTrim(addressParts.join(' '));
  if (addressJoinedUpper.includes('ADDRESS1') && addressJoinedUpper.includes('ADDRESS2')) {
    return false;
  }

  // require a real id (digits)
  const card_number = pickCardNumber(row);
  if (!card_number) return false;

  return true;
}

function mapFileStatusToAppStatus(fileStatus) {
  const s = toUpperTrim(fileStatus);

  // Common explicit values
  if (s === 'DELIVERED') return 'Delivered';
  if (s === 'IN TRANSIT') return 'Handed to Courier';


  if (s.includes('BAD') || s.includes('DOUBLE')) return 'Not Found';

  // Unknown / empty placeholder
  if (!s) return 'Pending';

  // Fallback
  return 'Pending';
}


function buildAddress(row) {
  const parts = [
    row['ADDRESS1'],
    row['ADDRESS2'],
    row['ADDRESS3'],
    row['ADDRESS4'],
    row['CITY'],
    row['ZIPCODE'],
  ]
    .map(v => String(v ?? '').trim())
    .filter(Boolean);

  return parts.join(', ');
}


function pickCardNumber(row) {
  const panDigits = cleanDigits(row['PAN']);
  if (panDigits.length === 16) return panDigits;

  const ref = String(row['REFERENCE NUMBER'] ?? '').trim();
  if (cleanDigits(ref).length > 0) return ref;

  const awb = String(row['AWB NUMBER'] ?? '').trim();
  if (cleanDigits(awb).length > 0) return awb;

  return '';
}

//routes
router.get('/', async (req, res) => {
  try {
    const batchId = req.query.batchId || null;

    if (!batchId) {
      return res.render('deliveries', {
        deliveries: [],
        batchId: null
      });
    }

    let deliveries = await CardDelivery.find({ import_batch_id: batchId })
      .sort({ updated_at: -1 })
      .lean();

    deliveries = deliveries.map(d => ({
      ...d,
      id: d._id.toString(),
    }));

    return res.render('deliveries', {
      deliveries,
      batchId   // ✅ IMPORTANT
    });
  } catch (err) {
    console.error('Error fetching deliveries:', err);
    return res.status(500).send('Error loading deliveries');
  }
});


router.post('/', deliveryValidationRules, async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    console.warn('[Create Delivery] Validation failed:', errors.array());
    return res
      .status(400)
      .send(
        'Validation error: ' +
          errors.array().map(e => e.msg).join(', ')
      );
  }

  try {
    const { card_number, recipient_name, address, courier } = req.body;

    const created = await CardDelivery.create({
      card_number,
      recipient_name,
      address,
      courier,
      status: 'Pending',
      updated_at: new Date(),
    });

    await addAuditLog(req, {
      action_type: 'CREATE_DELIVERY',
      entity_type: 'CardDelivery',
      entity_id: created._id.toString(),
      source: 'Deliveries Page',
      remarks: `Created delivery for card **** **** **** ${last4(card_number)}`,
    });

    res.redirect('/deliveries');
  } catch (err) {
    console.error('Error creating delivery:', err);
    res.status(500).send('Error creating delivery');
  }
});


router.post("/import", upload.single("excel_file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.redirect("/deliveries");
    }

    const batchId = crypto.randomUUID();

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = parseProgressiveReportRows(sheet);

    console.log("[Import] Parsed rows:", rows.length);

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
      const courier = String(row["PORT"] ?? "-").trim() || "-";
      const status = mapFileStatusToAppStatus(row["STATUS"]);

      docs.push({
        card_number,
        recipient_name,
        address,
        courier,
        status,
        updated_at: new Date(),

        import_batch_id: batchId,
        imported_by: req.user?.id || req.user?.email || req.user?.name || "system",
        imported_at: new Date(),
      });
    }

    if (docs.length === 0) {
      console.warn("[Import] No valid rows found in file");
      // ✅ only ONE response
      return res.redirect("/deliveries");
    }

    const result = await CardDelivery.insertMany(docs);
    console.log(`[Import] Successfully inserted ${result.length} deliveries. Invalid rows: ${invalidCount}`);

    // ✅ log audit with import_batch_id
    await addAuditLog(req, {
      action_type: "IMPORT_DELIVERIES",
      entity_type: "CardDelivery",
      entity_id: "BULK",
      source: "Deliveries Import",
      remarks: `Imported ${result.length} deliveries from Excel. Skipped ${invalidCount} invalid rows.`,
      import_batch_id: batchId,
    });

    // ✅ Redirect to the batch you just imported (ONE response)
    return res.redirect(`/deliveries?batchId=${encodeURIComponent(batchId)}`);

  } catch (err) {
    console.error("Error importing deliveries:", err);

    // ✅ avoid "headers already sent" crash
    if (res.headersSent) return;

    return res.status(500).send("Error importing deliveries");
  }
});

router.post('/clear-session', (req, res) => {
  res.clearCookie('last_import_batch');
  return res.redirect('/deliveries');
});


router.post('/:id/status', async (req, res) => {
  try {
    const deliveryId = req.params.id;


    const new_status = req.body.status;

    const allowedStatuses = [
      'Pending',
      'Pulled Out',
      'Not Found',
      'Handed to Courier',
      'Delivered',
      'Returned to Printer',
      'Destroyed',
      'Reprocessing',
    ];

    if (!allowedStatuses.includes(new_status)) {
      return res.status(400).send('Invalid status');
    }

    const existing = await CardDelivery.findById(deliveryId).lean();
    const oldStatus = existing ? existing.status : null;

    await CardDelivery.findByIdAndUpdate(deliveryId, {
      status: new_status,
      updated_at: new Date(),
    });

    await addAuditLog(req, {
      action_type: 'UPDATE_STATUS',
      entity_type: 'CardDelivery',
      entity_id: deliveryId,
      field: 'status',
      old_value: oldStatus,
      new_value: new_status,
      source: 'Deliveries Page',
      remarks: `Status updated by ${req.user?.name || 'Unknown'}`,
    });

    res.redirect('/deliveries');
  } catch (err) {
    console.error('Error updating delivery status:', err);
    res.status(500).send('Error updating delivery status');
  }
});

router.post('/wip', async (req, res) => {
  return res.status(403).render('wip');
});

module.exports = router;
