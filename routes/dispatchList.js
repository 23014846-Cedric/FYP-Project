const express = require("express");
const router = express.Router();

const multer = require("multer");
const XLSX = require("xlsx");

const DispatchList = require("../models/dispatchList"); // ✅ your model file
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
  return XLSX.utils.sheet_to_json(ws, { defval: "" }); // keep empty cells
}

/* --------------------------
  Views (session-based like deliveries.ejs)
  Mounted at: /deliveries/dispatchlist
--------------------------- */
router.get("/", async (req, res) => {
  const batchId = req.query.batch || req.session.dispatchBatchId || "";
  const dispatches = req.session.dispatches || [];
  return res.render("deliveries/dispatchList", { dispatches, batchId });
});

router.post("/clear-session", (req, res) => {
  req.session.dispatches = [];
  req.session.dispatchBatchId = "";
  return res.redirect("/deliveries/dispatchlist");
});

/* --------------------------
  Import Excel
  POST /deliveries/dispatchlist/import
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
          mobileNo: obj["MOBILE NO."] || obj["MOBILE NO"] || "",

          product: obj["PRODUCT"] || "",
          referenceNumber: obj["REFERENCE NUMBER"] || "",
          fileName: obj["FILE NAME"] || "",
          awbNumber: obj["AWB NUMBER"] || "",
          dispatchDate: parseDate(obj["DISPATCH DATE"]),
        };
      })
      .filter((x) => x.referenceNumber || x.name);

    // Save to session (like deliveries)
    const batchId = String(Date.now());
    req.session.dispatches = mapped;
    req.session.dispatchBatchId = batchId;

    // Optional: also persist into DB (upsert)
    const ops = mapped
      .filter((m) => m.referenceNumber) // avoid upserting blank keys
      .map((m) => ({
        updateOne: {
          filter: { referenceNumber: m.referenceNumber, fileName: m.fileName || "" },
          update: { $set: m },
          upsert: true,
        },
      }));

    if (ops.length) {
      await DispatchList.bulkWrite(ops, { ordered: false });
    }

    return res.redirect(`/deliveries/dispatchlist?batch=${batchId}`);
  } catch (err) {
    console.error("Dispatch import error:", err);
    return res.status(500).send("Failed to import dispatch list.");
  }
});

module.exports = router;
