const xlsx = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'MatchMove Progressive Report.xlsx');
console.log('Reading file from:', filePath);

try {
  const wb = xlsx.readFile(filePath);
  console.log('\nSheet names:', wb.SheetNames);
  
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

  console.log('\nTotal rows:', rows.length);
  
  if (rows.length > 0) {
    console.log('\nColumn headers:');
    const headers = Object.keys(rows[0]);
    headers.forEach(h => console.log('  -', h));

    console.log('\nFirst row data:');
    console.log(rows[0]);

    console.log('\nSecond row data (if exists):');
    if (rows[1]) console.log(rows[1]);
  }
} catch (err) {
  console.error('Error:', err.message);
}
