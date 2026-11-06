import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseVehicleDocument, calculateUtil } from '../src/document-processing.js';

// Synthetic PDF.js items retain the real failure's character positions, no customer data.
const source = readFileSync(new URL('../src/document-processing.js', import.meta.url), 'utf8');
async function documentFromItems(items) {
  const context = vm.createContext({ Uint8Array, getDocumentProxy: async () => ({}), extractTextItems: async () => ({ items }) });
  const start = source.indexOf('function normalize(');
  const end = source.indexOf('\nfunction pageValue(');
  vm.runInContext(source.slice(start, end).replace('export async function', 'async function'), context);
  return context.readPdf(new Uint8Array());
}
const item = (str, x, y, width = str.length * 5.52) => ({ str, x, y, width, fontSize: 11.04 });
const row = (label, value, y) => [item(label, 44.664, y), item(value, 206.74, y)];
function sbktsItems() {
  return [
    [item('Свидетельство о безопасности конструкции транспортного средства', 44, 800),
      ...row('МАРКА', 'TEST', 780), ...row('ГОД ВЫПУСКА', '2025', 760), ...row('КАТЕГОРИЯ', 'M1', 740)],
    [...row('Двигатель внутреннего сгорания', 'TEST ENGINE', 420),
      item('- рабочий объем цилиндров,', 44.664, 366.82), item('1', 206.74, 366.82), item('997', 212.02, 366.82),
      item('см³', 44.664, 354.1),
      ...row('- степень сжатия', '10,5', 339.7),
      item('- максимальная мощность, кВт', 44.664, 323.86),
      item('18', 206.74, 323.86), item('4', 217.78, 323.86),
      item('(', 226.18, 323.86, 3.67632), item('55', 229.78, 323.86, 10.8), item('00)', 240.58, 323.86)]
  ];
}

test('PDF numeric glyph fragments preserve the complete engine volume AND power', async () => {
  const vehicle = parseVehicleDocument(await documentFromItems(sbktsItems()));
  assert.equal(vehicle.ccm, 1997);
  assert.equal(vehicle.engineMaxKw, 184);
  assert.equal(vehicle.totalKw, 184);
  assert.equal(vehicle.hybridType, 'combustion');
  assert.ok(calculateUtil(vehicle, new Date('2026-11-06'))[0].commercial > 0);
});

test('touching decimal fragments preserve fractional 30-minute power', async () => {
  const items = sbktsItems();
  items[1].push(item('максимальная 30-минутная мощность, кВт', 44, 250),
    item('0', 206, 250, 5.52), item(',', 211.52, 250, 2.76), item('0001', 214.28, 250));
  const document = await documentFromItems(items);
  assert.match(document.text, /кВт 0,0001/);
  assert.doesNotMatch(document.text, /кВт 0 , 0001/);
});

test('separate columns and explicitly spaced values are never concatenated', async () => {
  const items = sbktsItems();
  items[1].push(item('30', 206, 200, 11), item('40', 250, 200),
    item('50 ', 206, 180, 15), item('60', 221, 180));
  const document = await documentFromItems(items);
  assert.match(document.text, /30 40/);
  assert.match(document.text, /50 60/);
});

test('EPTS extraction remains unchanged', async () => {
  const document = await documentFromItems([[item('Выписка из электронного паспорта транспортного средства', 44, 800),
    item('18', 350, 500), item('4', 361.04, 500)]]);
  assert.match(document.text, /18 4/);
});
