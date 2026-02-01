const xlsx = require('xlsx');

function toUpperTrim(v) { return String(v ?? '').trim().toUpperCase(); }

function normKey(k = '') {
  return String(k).trim().toUpperCase().replace(/\s+/g, ' ');
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

const wb = xlsx.readFile('../MatchMove Progressive Report.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const matrix = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

let headerRowIndex = 3; // We know it's row 3
const dataRow = matrix[headerRowIndex + 1];
const headers = matrix[headerRowIndex];

// This is what parseProgressiveReportRows does
const obj = {};
for (let c = 0; c < dataRow.length; c++) obj[c] = dataRow[c];
for (let c = 0; c < headers.length; c++) {
  const key = headers[c];
  if (!key) continue;
  obj[key] = dataRow[c];
}

console.log('obj keys:', Object.keys(obj));
console.log('obj["NAME"]:', obj["NAME"]);
console.log('obj["REFERENCE NUMBER"]:', obj["REFERENCE NUMBER"]);
console.log('obj["MOBILE NO."]:', obj["MOBILE NO."]);

// Now simulate the map function
const normalized = {};
for (const k of Object.keys(obj)) normalized[normKey(k)] = obj[k];

console.log('\nAfter normKey mapping:');
console.log('normalized keys:', Object.keys(normalized));
console.log('normalized["NAME"]:', normalized["NAME"]);
console.log('normalized["REFERENCE NUMBER"]:', normalized["REFERENCE NUMBER"]);
console.log('normalized["MOBILE NO."]:', normalized["MOBILE NO."]);

// Now test the final mapping
const mapped = {
  number: normalized["NUMBER"] || normalized["NO"] || 1,
  name: normalized["NAME"] || "",
  pan: normalized["PAN"] || "",
  address1: normalized["ADDRESS1"] || "",
  address2: normalized["ADDRESS2"] || "",
  address3: normalized["ADDRESS3"] || "",
  address4: normalized["ADDRESS4"] || "",
  zipCode: normalized["ZIPCODE"] || normalized["ZIP CODE"] || "",
  mobileNo: normalized["MOBILE NO."] || normalized["MOBILE NO"] || "",
  product: normalized["PRODUCT"] || "",
  referenceNumber: normalized["REFERENCE NUMBER"] || "",
  fileName: normalized["FILE NAME"] || "",
  awbNumber: normalized["AWB NUMBER"] || "",
  dispatchDate: parseDate(normalized["DISPATCH DATE"]),
  receivedBy: normalized["RECEIVED BY"] || "",
  receivedDate: parseDate(normalized["RECEIVED DATE"]),
  status: String(normalized["STATUS"] || "").trim(),
  remarks: normalized["REMARKS"] || "",
  port: normalized["PORT"] || "",
};

console.log('\nFinal mapped object:');
console.log(JSON.stringify(mapped, null, 2));
console.log('\nFilter check:');
console.log('Will pass filter (referenceNumber || name)?', !!(mapped.referenceNumber || mapped.name));
