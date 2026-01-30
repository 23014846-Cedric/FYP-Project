const express = require("express");
const router = express.Router();

const multer = require("multer");
const XLSX = require("xlsx");

const ProgressiveReport = require("../models/progressiveReport"); // ✅ matches your created model file
const upload = multer({ storage: multer.memoryStorage() });

/* --------------------------
  Helpers
--------------------------- */
function normKey(k = "") {
  return String(k).trim().toUpperCase().replace(/\s+/g, " ");
}

function parseDate(val) {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date && !isNaN(val)) return val;

  // Excel serial date
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
  }

  // String date
  const s = String(val).trim();
  const d2 = new Date(s);
  if (!isNaN(d2)) return d2;

  return null;
}

function sheetToRows(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

/* --------------------------
  Views (session-based)
  Mounted at: /deliveries/progressivereports
--------------------------- */
router.get("/", async (req, res) => {
  const batchId = req.query.batch || req.session.progressiveBatchId || "";
  const reports = req.session.reports || [];
  return res.render("deliveries/progressiveReport", { reports, batchId });
});

router.post("/clear-session", (req, res) => {
  req.session.reports = [];
  req.session.progressiveBatchId = "";
  return res.redirect("/deliveries/progressivereports");
});

/* --------------------------
  Import Excel
  POST /deliveries/progressivereports/import
--------------------------- */
router.post("/import", upload.single("excel_file"), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).send("No file uploaded.");

    const rows = sheetToRows(req.file.buffer);

    const mapped = rows
      .map((r, idx) => {
        const obj = {};
        for (const k of Object.keys(r)) obj[normKey(k)] = r[k];

        return {
          number: obj["NUMBER"] || obj["NO"] || (idx + 1),
          name: obj["NAME"] || "",
          pan: obj["PAN"] || "",

          address1: obj["ADDRESS1"] || "",
          address2: obj["ADDRESS2"] || "",
          address3: obj["ADDRESS3"] || "",
          address4: obj["ADDRESS4"] || "",

          zipCode: obj["ZIPCODE"] || obj["ZIP CODE"] || "",
          mobileNo: obj["MOBILE NO."] || obj["MOBILE NO"] || "",

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
      })
      .filter((x) => x.referenceNumber || x.name);

    // Save to session
    const batchId = String(Date.now());
    req.session.reports = mapped;
    req.session.progressiveBatchId = batchId;

    // Optional: persist to DB (upsert)
    const ops = mapped
      .filter((m) => m.referenceNumber)
      .map((m) => ({
        updateOne: {
          filter: { referenceNumber: m.referenceNumber, awbNumber: m.awbNumber || "" },
          update: { $set: m },
          upsert: true,
        },
      }));

    if (ops.length) {
      await ProgressiveReport.bulkWrite(ops, { ordered: false });
    }

    return res.redirect(`/deliveries/progressivereports?batch=${batchId}`);
  } catch (err) {
    console.error("Progressive import error:", err);
    return res.status(500).send("Failed to import progressive report.");
  }
});

module.exports = router;
