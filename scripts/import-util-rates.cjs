/*
 * Converts the source Excel directory of util-fee rates into the single JSON
 * catalogue used by the bot and Mini App. Run:
 * node scripts/import-util-rates.cjs [source.xlsx] [target.json]
 */
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const source = process.argv[2] || path.join(root, 'tabs', 'utilsbor', 'util-rates-source.xlsx');
const target = process.argv[3] || path.join(root, 'shared', 'util-rates.json');
const workbook = XLSX.readFile(source);
const BASE = { M1: 20000, cargo: 150000 };
const years = [2025, 2026, 2027, 2028, 2029, 2030];

function numeric(value) {
  const result = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(result) ? result : null;
}

function range(text, scale = 1) {
  const value = String(text || '').replace(/,/g, '.').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const numbers = [...value.matchAll(/\d+(?:\.\d+)?/g)].map(match => Number(match[0]) * scale);
  if (!numbers.length) return { min: null, max: null, minExclusive: false };
  if (/^[≤<]/.test(value)) return { min: 0, max: numbers[0], minExclusive: false };
  if (/^[≥>]/.test(value)) return { min: numbers[0], max: null, minExclusive: true };
  if (numbers.length >= 2) return { min: numbers[0], max: numbers[1], minExclusive: true };
  return { min: numbers[0], max: numbers[0], minExclusive: false };
}

function addRateRow(records, data) {
  const coefficients = {};
  for (const year of years) {
    const newCoefficient = numeric(data.values[`${year} new`]);
    const oldCoefficient = numeric(data.values[`${year} old`]);
    if (newCoefficient !== null || oldCoefficient !== null) coefficients[year] = { new: newCoefficient, old: oldCoefficient };
  }
  if (Object.keys(coefficients).length) records.push({ ...data, coefficients });
}

function rowValues(header, row) {
  return Object.fromEntries(header.map((name, index) => {
    const label = String(name || '').replace(/нов\S*/i, 'new').replace('>3 лет', 'old').replace('2030+', '2030');
    return [label, row[index]];
  }));
}

function cargoType(label) {
  const lower = label.toLowerCase();
  if (lower.includes('международ')) return { id: 'tractor-international', label: 'Седельный тягач для международных перевозок' };
  if (lower.includes('седельн')) return { id: 'tractor', label: 'Седельный тягач' };
  if (lower.includes('самосвал')) return { id: 'dump-truck', label: 'Самосвал' };
  if (lower.includes('фургон') || lower.includes('рефриж')) return { id: 'van', label: 'Фургон / рефрижератор' };
  return { id: 'cargo', label: 'Грузовой автомобиль' };
}

function cargoCategory(mass) {
  if (mass.max !== null && mass.max <= 3500) return 'N1';
  if (mass.max !== null && mass.max <= 12000) return 'N2';
  return 'N3';
}

const records = [];
function importM1(sheetName, powertrain, payer) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });
  const header = rows[0];
  for (const row of rows.slice(1)) {
    const volume = powertrain === 'combustion' ? range(row[0]) : { min: null, max: null, minExclusive: false };
    const power = range(row[powertrain === 'combustion' ? 1 : 1]);
    addRateRow(records, {
      category: 'M1', vehicleType: 'passenger', vehicleTypeLabel: 'Легковой автомобиль',
      powertrain, payer, baseRate: BASE.M1,
      ccm: volume, power, source: `${sheetName}: ${row[0]} / ${row[1]}`,
      values: rowValues(header, row)
    });
  }
}

importM1('M1 электро и последовательные', 'electric', 'commercial');
importM1('M1 ДВС все объемы', 'combustion', 'commercial');
importM1('M1 физлица электро', 'electric', 'personal');
importM1('M1 физлица ДВС', 'combustion', 'personal');

const cargoRows = XLSX.utils.sheet_to_json(workbook.Sheets['N1-N2-N3 грузовые'], { header: 1, defval: null });
const cargoHeader = cargoRows[0];
for (const row of cargoRows.slice(1)) {
  const label = String(row[1] || '');
  const mass = range(label, 1000);
  const type = cargoType(label);
  addRateRow(records, {
    category: cargoCategory(mass), vehicleType: type.id, vehicleTypeLabel: type.label,
    powertrain: 'any', payer: 'commercial', baseRate: BASE.cargo,
    mass, ccm: null, power: null, source: `N1-N2-N3 грузовые, строка ${row[0]}: ${label}`,
    values: rowValues(cargoHeader, row)
  });
}

const result = {
  version: 1,
  source: 'util_sbor_polnyy_spravochnik_s_kommentariyami.xlsx',
  generatedAt: new Date().toISOString(),
  baseRates: BASE,
  records: records.map(({ values, ...record }) => record)
};
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
console.log(`Imported ${result.records.length} util-fee rate records to ${path.relative(root, target)}`);
