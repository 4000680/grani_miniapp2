#!/usr/bin/env node
/*
 * Конвертирует tabs/utilsbor/spravochnik.xlsx в компактный сжатый формат
 * tabs/utilsbor/spravochnik.json.gz.b64 — именно его загружает калькулятор в браузере.
 * Логика разбора листа 1-в-1 повторяет то, что раньше делала функция loadDB() в браузере
 * через SheetJS, чтобы результат поиска не отличался.
 *
 * Использование: node scripts/convert-spravochnik.js <путь-к-xlsx> <путь-для-результата>
 */
const fs = require('fs');
const zlib = require('zlib');
const XLSX = require('xlsx');

const inputPath = process.argv[2] || 'tabs/utilsbor/spravochnik.xlsx';
const outputPath = process.argv[3] || 'tabs/utilsbor/spravochnik.json.gz.b64';

const wb = XLSX.readFile(inputPath, { cellDates: false });
const sheetName = wb.SheetNames.includes('Данные') ? 'Данные' : wb.SheetNames[0];
const ws = wb.Sheets[sheetName];
const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 1, blankrows: false, defval: null });

const brandIdx = new Map(), modelIdx = new Map(), ecoIdx = new Map();
const brands = [], models = [], eco = [];
const rows = [];

for (const r of rawRows) {
  const brand = r[1], model = r[2];
  if (brand === null || brand === undefined || brand === '') continue;
  const brandStr = String(brand).trim();
  const modelStr = model !== null && model !== undefined ? String(model).trim() : '';
  const ecoStr = r[3] !== null && r[3] !== undefined ? String(r[3]).trim() : null;

  if (!brandIdx.has(brandStr)) { brandIdx.set(brandStr, brands.length); brands.push(brandStr); }
  if (!modelIdx.has(modelStr)) { modelIdx.set(modelStr, models.length); models.push(modelStr); }
  let eIdx = -1;
  if (ecoStr !== null) {
    if (!ecoIdx.has(ecoStr)) { ecoIdx.set(ecoStr, eco.length); eco.push(ecoStr); }
    eIdx = ecoIdx.get(ecoStr);
  }

  rows.push([
    brandIdx.get(brandStr),
    modelIdx.get(modelStr),
    r[4] !== null && r[4] !== undefined ? Number(r[4]) : null, // год
    eIdx,
    r[5] !== null && r[5] !== undefined ? Number(r[5]) : null, // мощность
    r[6] !== null && r[6] !== undefined ? Number(r[6]) : null, // 30-мин мощность
    r[7] !== null && r[7] !== undefined ? Number(r[7]) : null, // масса
    r[8] !== null && r[8] !== undefined ? Number(r[8]) : null, // нижний предел
    r[9] !== null && r[9] !== undefined ? Number(r[9]) : null, // верхний предел
  ]);
}

const payload = JSON.stringify({ brands, models, eco, rows });
// zlib.deflateSync (формат zlib/RFC1950, без временных меток в заголовке) —
// на выходе детерминированные байты при одинаковых входных данных, поэтому
// git не будет коммитить «пустые» изменения, если справочник не менялся.
// В браузере распаковывается через pako.inflate(bytes, {to:'string'}) — тот же формат.
const compressed = zlib.deflateSync(Buffer.from(payload, 'utf-8'), { level: 9 });
const b64 = compressed.toString('base64');

fs.writeFileSync(outputPath, b64, 'utf-8');

const origSize = fs.statSync(inputPath).size;
const newSize = fs.statSync(outputPath).size;
console.log(`Строк: ${rows.length}, марок: ${brands.length}, моделей: ${models.length}`);
console.log(`Исходный xlsx: ${(origSize / 1024 / 1024).toFixed(2)} МБ`);
console.log(`Сжатый файл:   ${(newSize / 1024 / 1024).toFixed(2)} МБ`);
console.log(`Уменьшение:    ${(100 - (newSize / origSize) * 100).toFixed(1)}%`);
