// routes/deliveryRouter.js
const express = require('express');
const router = express.Router();

const CardDelivery = require('../models/CardDelivery');
const AuditLog = require('../models/AuditLog');

const multer = require('multer');
const xlsx = require('xlsx');
const { body, validationResult } = require('express-validator');

// Multer: temporary upload folder
const upload = multer({ dest: 'uploads/' });

console.log('[deliveryRouter] loaded');

// Helper: mask card for logs (PDPA – only last 4 digits)
function last4(card) {
  if (!card) return '****';
  const clean = String(card).replace(/\s+/g, '');
  return clean.slice(-4);
}

// Inline helper: write an audit log entry
async function addAuditLog(req, {
  action_type,
  entity_type,
  entity_id,
  field = null,
  old_value = null,
  new_value = null,
  source = "Web",
  remarks = "",
}) {
  try {
    const user = req.user || null;

    await AuditLog.create({
      username: user ? user.name : "System",
      user_id: user ? user.id : null,
      action_type,
      entity_type,
      entity_id,
      field,
      old_value: old_value !== undefined && old_value !== null
        ? String(old_value)
        : null,
      new_value: new_value !== undefined && new_value !== null
        ? String(new_value)
        : null,
      source,
      remarks,
    });
  } catch (err) {
    console.error("Error writing audit log:", err);
  }
}

// Reusable validation rules for a single delivery (FR24)
const deliveryValidationRules = [
  body('card_number')
    .trim()
    .matches(/^\d{16}$/).withMessage('Card number must be 16 digits'),
  body('recipient_name')
    .trim()
    .notEmpty().withMessage('Recipient name is required')
    .isLength({ max: 100 }).withMessage('Recipient name too long'),
  body('address')
    .trim()
    .notEmpty().withMessage('Address is required'),
  body('courier')
    .optional({ checkFalsy: true })
    .isLength({ max: 50 }).withMessage('Courier name too long'),
  body('status')
    .optional()
    .isIn(['Pending', 'Shipped', 'Delivered', 'Failed'])
    .withMessage('Invalid status value')
];

/**
 * GET /deliveries
 * Show all deliveries in the table
 */
router.get('/', async (req, res) => {
  try {
    let deliveries = await CardDelivery.find().sort({ updated_at: -1 }).lean();

    deliveries = deliveries.map(d => ({
      ...d,
      id: d._id.toString(),
    }));

    res.render('deliveries', { deliveries });
  } catch (err) {
    console.error('Error fetching deliveries:', err);
    res.status(500).send('Error loading deliveries');
  }
});

/**
 * POST /deliveries
 * Manual create – now with validation (FR24)
 */
router.post(
  '/',
  deliveryValidationRules,
  async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      console.warn('[Create Delivery] Validation failed:', errors.array());

      // If you have a "create delivery" form view, you can render it with errors.
      // For now, send a simple 400 with error messages.
      return res.status(400).send(
        'Validation error: ' + errors.array().map(e => e.msg).join(', ')
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

      // Audit: track creation (mask card in logs – PDPA)
      await addAuditLog(req, {
        action_type: "CREATE_DELIVERY",
        entity_type: "CardDelivery",
        entity_id: created._id.toString(),
        field: null,
        old_value: null,
        new_value: null,
        source: "Deliveries Page",
        remarks: `Created delivery for card **** **** **** ${last4(card_number)}`,
      });

      res.redirect('/deliveries');
    } catch (err) {
      console.error('Error creating delivery:', err);
      res.status(500).send('Error creating delivery');
    }
  }
);

/**
 * Helper: basic validation for Excel row (FR24 for import)
 */
function validateExcelRow(row) {
  const card = row['Card #'];
  const recipient = row['Recipient'];
  const address = row['Address'];

  if (!card || !recipient || !address) return false;
  const cleanCard = String(card).replace(/\s+/g, '');
  if (!/^\d{16}$/.test(cleanCard)) return false;

  return true;
}

/**
 * POST /deliveries/import
 * Import deliveries from Excel (with basic validation & PDPA-safe logs)
 */
router.post('/import', upload.single('excel_file'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('No file uploaded');
      return res.redirect('/deliveries');
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    console.log('[Import] Raw rows from Excel:', rows);

    const docs = [];
    let invalidCount = 0;

    for (const row of rows) {
      if (!validateExcelRow(row)) {
        invalidCount++;
        continue;
      }

      const rawStatus = row['Status'];

      // Normalise status (Excel has "In Transit", DB uses "Shipped")
      let status = 'Pending';
      if (rawStatus === 'Delivered') status = 'Delivered';
      else if (rawStatus === 'In Transit') status = 'Shipped';
      else if (['Pending', 'Shipped', 'Failed'].includes(rawStatus)) status = rawStatus;

      docs.push({
        card_number: String(row['Card #']).replace(/\s+/g, ''),
        recipient_name: row['Recipient'],
        address: row['Address'],
        courier: row['Courier'] || '-',
        status,
        updated_at: new Date(),   // just use "now"
      });
    }

    if (docs.length === 0) {
      console.warn('[Import] No valid rows found in file');
      return res.redirect('/deliveries');
    }

    const result = await CardDelivery.insertMany(docs);
    console.log(`[Import] Successfully inserted ${result.length} deliveries. Invalid rows: ${invalidCount}`);

    // Audit: log bulk import (no raw card numbers)
    await addAuditLog(req, {
      action_type: "IMPORT_DELIVERIES",
      entity_type: "CardDelivery",
      entity_id: "BULK",
      field: null,
      old_value: null,
      new_value: null,
      source: "Deliveries Import",
      remarks: `Imported ${result.length} deliveries from Excel. Skipped ${invalidCount} invalid rows.`,
    });

    res.redirect('/deliveries');
  } catch (err) {
    console.error('Error importing deliveries:', err);
    res.status(500).send('Error importing deliveries');
  }
});

/**
 * POST /deliveries/:id/status
 * Update the status of an existing delivery
 */
router.post('/:id/status', async (req, res) => {
  try {
    const deliveryId = req.params.id;
    const { new_status } = req.body;

    // Optional: validate status here as well
    const allowedStatuses = [
      'Pending',
      'Pulled Out',
      'Not Found',
      'Handed to Courier',
      'Delivered',
      'Returned to Printer',
      'Destroyed',
      'Reprocessing'
    ];
    if (!allowedStatuses.includes(new_status)) {
      return res.status(400).send('Invalid status');
    }

    // Get the existing delivery to capture old status
    const existing = await CardDelivery.findById(deliveryId).lean();
    const oldStatus = existing ? existing.status : null;

    await CardDelivery.findByIdAndUpdate(deliveryId, {
      status: new_status,
      updated_at: new Date(),
    });

    // Audit: who changed what
    await addAuditLog(req, {
      action_type: "UPDATE_STATUS",
      entity_type: "CardDelivery",
      entity_id: deliveryId,
      field: "status",
      old_value: oldStatus,
      new_value: new_status,
      source: "Deliveries Page",
      remarks: `Status updated by ${req.user?.name || "Unknown"}`,
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
