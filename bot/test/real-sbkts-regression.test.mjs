import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateUtil, parseVehicleDocument, processVehicleDocument, readPdf } from '../src/document-processing.js';

const controls = [
  {
    name: 'BYD real PDF',
    env: 'SBKTS_BYD_PDF',
    expected: { hybridType: 'parallel', engineMaxKw: 70, electric30MinKwList: [70], electric30MinKw: 70, totalKw: 140 }
  },
  {
    name: 'ZEEKR real PDF',
    env: 'SBKTS_ZEEKR_PDF',
    expected: { hybridType: 'parallel-series', engineMaxKw: 202, electric30MinKwList: [130.5, 166.5, 166.5], electric30MinKw: 463.5, totalKw: 665.5 }
  }
];

for (const control of controls) {
  test(control.name, { skip: !process.env[control.env] }, async () => {
    const document = await readPdf(await readFile(process.env[control.env]));
    const vehicle = parseVehicleDocument(document);
    for (const [key, value] of Object.entries(control.expected)) assert.deepEqual(vehicle[key], value, key);
    assert.ok(calculateUtil(vehicle, new Date('2026-09-19T00:00:00Z')).length > 0);
  });
}

test('real PDFs pass the same end-to-end processing pipeline used by Telegram', {
  skip: controls.some(control => !process.env[control.env])
}, async () => {
  for (const control of controls) {
    const result = await processVehicleDocument(
      await readFile(process.env[control.env]),
      new Date('2026-09-19T00:00:00Z')
    );
    assert.equal(result.vehicle.totalKw, control.expected.totalKw);
    assert.ok(result.util.length > 0);
    assert.ok(result.deadline instanceof Date);
  }
});
