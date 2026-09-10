const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'tabs', 'utilsbor', 'rates.xlsx');
const target = path.join(root, 'bot', 'src', 'rates-data.js');
const workbook = XLSX.readFile(source);
const sheet = workbook.Sheets[workbook.SheetNames.includes('Ставки') ? 'Ставки' : workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })
  .filter(row => String(row['Категория ТС'] || '').trim().toUpperCase() === 'M1')
  .map(row => ({
    engine: String(row['Тип двигателя'] || '').trim(),
    payer: String(row['Плательщик'] || '').trim(),
    ccmFrom: numberOrNull(row['Объём от, см³']),
    ccmTo: numberOrNull(row['Объём до, см³']),
    kwFrom: numberOrNull(row['Мощность от, кВт']) || 0,
    kwTo: numberOrNull(row['Мощность до, кВт']),
    sumNew: Number(row['Сумма руб (новое, до 3 лет)']),
    sumOld: Number(row['Сумма руб (старше 3 лет)'])
  }));

function numberOrNull(value) {
  return value === null || value === '' || value === undefined ? null : Number(value);
}

const output = [
  '// Generated from tabs/utilsbor/rates.xlsx. Do not edit by hand.',
  `export const UTIL_RATES = ${JSON.stringify(rows, null, 2)};`,
  ''
].join('\n');
fs.writeFileSync(target, output);
console.log(`Exported ${rows.length} M1 rate rows to ${path.relative(root, target)}`);
