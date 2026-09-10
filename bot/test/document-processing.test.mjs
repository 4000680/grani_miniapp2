import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addWorkingDays,
  calculatePeni,
  calculateUtil,
  parseFlexibleDate,
  parseVehicleDocument,
  toIso
} from '../src/document-processing.js';

function line(y, left, right, rightX = 395) {
  return {
    y,
    text: `${left} ${right}`.trim(),
    items: [{ x: 77, str: left }, ...(right ? [{ x: rightX, str: right }] : [])]
  };
}

test('parses an EPTS layout and uses the TR TS category', () => {
  const document = {
    text: 'Выписка\nиз электронного паспорта транспортного средства',
    pages: [[
      line(658, 'Марка', 'TEST BRAND'),
      line(679, 'Идентификационный номер', 'TESTVN00000000001'),
      line(638, 'Коммерческое наименование', 'TEST MODEL'),
      line(616, 'Категория транспортного средства', 'категория B'),
      line(566, 'Категория в соответствии с ТР ТС 018/2011', 'M1'),
      line(466, 'Месяц и год изготовления', 'октябрь 2021'),
      line(308, '– рабочий объем цилиндров (см³)', '2925'),
      line(291, '– максимальная мощность (кВт) (мин-1)', '243 (4200)'),
      line(252, 'Технически допустимая максимальная масса', '2580')
    ]]
  };
  const vehicle = parseVehicleDocument(document);
  assert.deepEqual(
    { type: vehicle.type, vin: vehicle.vin, year: vehicle.year, category: vehicle.category, ccm: vehicle.ccm, kw: vehicle.totalKw },
    { type: 'epts', vin: 'TESTVN00000000001', year: 2021, category: 'M1', ccm: 2925, kw: 243 }
  );
  assert.deepEqual(calculateUtil(vehicle, new Date('2026-09-10T00:00:00Z')), [
    { age: 'old', commercial: 3873600, personal: 3873600 }
  ]);
});

test('parses SБКТС and adds every 30-minute electric power', () => {
  const document = {
    text: 'СВИДЕТЕЛЬСТВО О БЕЗОПАСНОСТИ КОНСТРУКЦИИ ТРАНСПОРТНОГО СРЕДСТВА\nГибридное транспортное средство параллельного типа.\nДата оформления "02" сентября 2026 г.',
    pages: [
      [line(476, 'МАРКА', 'TEST BRAND', 206), line(460, 'КОММЕРЧЕСКОЕ', 'TEST MODEL', 206), line(401, 'ИДЕНТИФИКАЦИОННЫЙ', 'TESTVN00000000002', 206), line(374, 'ГОД ВЫПУСКА', '2026 г.', 206), line(358, 'КАТЕГОРИЯ', 'M1', 206)],
      [line(567, 'Технически допустимая максимальная масса', '2705', 206), line(277, '- рабочий объем цилиндров,', '1498', 206), line(234, '- максимальная мощность, кВт', '115 (5500)', 206)],
      [line(658, 'Максимальная 30-минутная', '90', 206), line(631, '', '36', 206)]
    ]
  };
  const vehicle = parseVehicleDocument(document);
  assert.equal(vehicle.totalKw, 241);
  assert.equal(vehicle.vin, 'TESTVN00000000002');
  assert.equal(vehicle.hybridType, 'параллельный');
  assert.deepEqual(vehicle.electricKw, [90, 36]);
  assert.equal(toIso(vehicle.issueDate), '2026-09-02');
  assert.deepEqual(calculateUtil(vehicle, new Date('2026-09-10T00:00:00Z')), [
    { age: 'new', commercial: 1459200, personal: 1459200 }
  ]);
  const deadline = addWorkingDays(vehicle.issueDate, 5);
  assert.equal(toIso(deadline), '2026-09-09');
  const peni = calculatePeni(1459200, deadline, new Date('2026-09-10T00:00:00Z'));
  assert.equal(peni.days, 1);
  assert.equal(peni.total, 680.96);
});

test('accepts common Russian date formats', () => {
  for (const value of ['02.09.2026', '2/9/26', '2026-09-02', '2 сентября 2026', 'сентябрь 2, 2026']) {
    assert.equal(toIso(parseFlexibleDate(value)), '2026-09-02');
  }
  assert.equal(parseFlexibleDate('31.02.2026'), null);
});
