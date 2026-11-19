import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateManual, calculatorOptions, calculateWebsiteDeclaration, handleWebsiteCalculator } from '../src/website-calculator.js';
import { calculateUtil } from '../src/document-processing.js';

const date = new Date('2026-11-19T12:00:00Z');
const vehicle = {
  type: 'epts', brand: 'Toyota', model: 'RAV 4', category: 'M1', year: 2024,
  hybridType: 'combustion', totalKw: 110, ccm: 1998,
};

test('site uses the shared rates for passenger and cargo categories', () => {
  const totals = calculateManual({ category: 'M1', hybridType: 'combustion', year: '2023', ccm: '1998', engineKw: '110' }, date);
  assert.deepEqual(totals.results.map(row => row.age), ['new', 'old']);
  const expected = calculateUtil({ ...vehicle, year: 2023 }, date);
  assert.deepEqual(totals.results.map(row => row.fees.map(fee => fee.amount)),
    expected.map(row => [row.personal, row.commercial]));
  for (const [category, maxMass] of [['N1', 2500], ['N2', 5000]]) {
    const truck = calculateManual({ category, maxMass, year: 2024, hybridType: 'combustion' }, date);
    assert.equal(truck.results[0].fees.length, 1);
    assert.equal(truck.vehicle.maxMass, maxMass);
    assert.ok(truck.results[0].fees[0].coefficient > 0);
  }
  assert.ok(calculatorOptions(2026).rows.some(row => row.category === 'M1' && row.powertrain === 'electric' && row.reduced));
});

test('parallel and series power use the same calculation as the bot', () => {
  const input = { category: 'M1', year: '2024', ccm: '1998', engineKw: '110', electricKw: '30' };
  assert.equal(calculateManual({ ...input, hybridType: 'parallel' }, date).vehicle.totalKw, 140);
  assert.equal(calculateManual({ ...input, hybridType: 'series' }, date).vehicle.totalKw, 30);
  assert.throws(() => calculateManual({ ...input, category: 'N1', hybridType: 'ev' }, date), /категория M1/);
});

test('declared payments use the selected model and currency, local assembly needs no rate', async () => {
  const noFetch = async () => assert.fail('ЦБ не нужен для нулевых платежей');
  const input = { country: 'BY', assembly: 'on' };
  const choices = await calculateWebsiteDeclaration(vehicle, input, date, noFetch);
  assert.equal(choices.choices[0].name, 'TOYOTA RAV 4');
  const local = await calculateWebsiteDeclaration(vehicle, { ...input, variant: '0' }, date, noFetch);
  assert.equal(local.paidDutyRub, 0);
  assert.equal(local.paidVatRub, 0);
  const paid = await calculateWebsiteDeclaration(vehicle, { country: 'KZ', duty: '100', vat: '200', variant: '0' }, date, async code => {
    assert.equal(code, 'KZT');
    return { unitRate: 0.2 };
  });
  assert.equal(paid.paidDutyRub, 20);
  assert.equal(paid.paidVatRub, 40);
  await assert.rejects(calculateWebsiteDeclaration(vehicle, { ...input, country: 'AM' }, date, noFetch), /Беларуси и Казахстана/);
});

test('document handler uses the existing PDF flow and omits VIN and name of owner', async () => {
  const form = new FormData();
  form.set('file', new File(['%PDF-test'], 'sample.pdf', { type: 'application/pdf' }));
  const request = new Request('https://test.example/api/website/util/document', {
    method: 'POST', headers: { Origin: 'https://grani-br.ru' }, body: form,
  });
  const response = await handleWebsiteCalculator(request, 'document', {
    readDocument: async bytes => {
      assert.equal(new TextDecoder().decode(bytes), '%PDF-test');
      return { vehicle: { ...vehicle, vin: 'TEST', surname: 'private' }, util: calculateUtil(vehicle, date) };
    },
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.vehicle.model, 'RAV 4');
  assert.equal(data.vehicle.vin, undefined);
  assert.equal(data.vehicle.surname, undefined);
});
