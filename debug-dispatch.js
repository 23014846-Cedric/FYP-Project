const xlsx = require('xlsx');
const path = require('path');

function normKey(k = "") {
  return String(k).trim().toUpperCase().replace(/\s+/g, " ");
}

const filePath = path.join(__dirname, '..', 'MatchMove Dispatch.xlsx');
console.log('Reading file from:', filePath);

try {
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

  console.log('Total rows:', matrix.length);
  
  // Find header row
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(5, matrix.length); i++) {
    const row = matrix[i].map(cell => String(cell || '').trim().toUpperCase());
    if (row.includes('NO') || row.includes('NAME') || row.includes('PAN')) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex !== -1) {
    const headerRow = matrix[headerRowIndex].map(cell => String(cell || '').trim());
    const dataRows = matrix.slice(headerRowIndex + 1);
    
    console.log('\n--- Normalized Headers ---');
    const normalizedHeaders = headerRow.map((h, i) => {
      const normalized = normKey(h);
      console.log(`  [${i}] "${h}" → "${normalized}"`);
      return normalized;
    });

    console.log('\n--- First Data Row Mapping ---');
    const dataRow = dataRows[0];
    const obj = {};
    for (let i = 0; i < headerRow.length; i++) {
      const header = normKey(headerRow[i]);
      obj[header] = dataRow[i] || "";
      if (i < 10) console.log(`  ${header} = ${obj[header]}`);
    }

    console.log('\n--- Final Mapped Object ---');
    const mapped = {
      no: obj["NO"] || 1,
      name: obj["NAME"] || "",
      pan: obj["PAN"] || "",
      address1: obj["ADDRESS1"] || "",
      referenceNumber: obj["REFERENCE NUMBER"] || "",
      fileName: obj["FILE NAME"] || "",
      awbNumber: obj["AWB NUMBER"] || "",
    };
    console.log(JSON.stringify(mapped, null, 2));
  }
} catch (err) {
  console.error('Error:', err.message);
}
