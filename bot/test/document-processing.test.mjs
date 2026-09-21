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

test('parses M1 hybrid data from a second EPTS page without adding the vehicle mass to kW', () => {
  const document = {
    text: [
      'Выписка из электронного паспорта транспортного средства',
      'комбинированная энергоустановка параллельного типа',
      'максимальная 30-минутная мощность 58'
    ].join('\n'),
    pages: [
      [
        line(658, 'Марка', 'Toyota'),
        line(638, 'Коммерческое наименование', 'CAMRY'),
        line(566, 'Категория в соответствии с ТР ТС 018/2011', 'M1'),
        line(466, 'Месяц и год изготовления', 'август 2026')
      ],
      [
        line(308, '– рабочий объем цилиндров (см³)', '1987'),
        line(291, '– максимальная мощность (кВт) (мин-1)', '112 (6000)'),
        line(270, '– максимальная 30-минутная мощность (кВт)', '58'),
        line(252, 'Технически допустимая максимальная масса', '2070')
      ]
    ]
  };
  const vehicle = parseVehicleDocument(document);
  assert.deepEqual(
    { category: vehicle.category, ccm: vehicle.ccm, combustionKw: vehicle.combustionKw, electricKw: vehicle.electricKw, totalKw: vehicle.totalKw, maxMass: vehicle.maxMass, hybridType: vehicle.hybridType },
    { category: 'M1', ccm: 1987, combustionKw: 112, electricKw: [58], totalKw: 170, maxMass: 2070, hybridType: 'parallel' }
  );
  assert.deepEqual(calculateUtil(vehicle, new Date('2026-09-21T00:00:00Z')), [
    { age: 'new', commercial: 1010400, personal: 1010400 }
  ]);
});

test('calculates pickup util from an EPTS N1G category and full mass', () => {
  const document = {
    text: 'Выписка\nиз электронного паспорта транспортного средства',
    pages: [[
      line(658, 'Марка', 'RAM'),
      line(638, 'Коммерческое наименование', '1500 REBEL'),
      line(566, 'Категория в соответствии с ТР ТС 018/2011', 'N1G'),
      line(466, 'Месяц и год изготовления', 'сентябрь 2025'),
      line(308, '– рабочий объем цилиндров (см³)', '2993'),
      line(252, 'Технически допустимая максимальная масса', '3220')
    ]]
  };
  const vehicle = parseVehicleDocument(document);
  assert.deepEqual(
    { category: vehicle.category, year: vehicle.year, ccm: vehicle.ccm, maxMass: vehicle.maxMass },
    { category: 'N1G', year: 2025, ccm: 2993, maxMass: 3220 }
  );
  assert.deepEqual(calculateUtil(vehicle, new Date('2026-09-21T00:00:00Z')), [
    { age: 'new', commercial: 990000, personal: 990000, pickup: true, utilCoefficient: 6.6 }
  ]);
});

test('calculates pickup util from an SBKTS N1 category and full mass', () => {
  const document = {
    text: 'СВИДЕТЕЛЬСТВО О БЕЗОПАСНОСТИ КОНСТРУКЦИИ ТРАНСПОРТНОГО СРЕДСТВА',
    pages: [
      [line(476, 'МАРКА', 'TEST', 206), line(460, 'КОММЕРЧЕСКОЕ', 'PICKUP', 206), line(374, 'ГОД ВЫПУСКА', '2024 г.', 206), line(358, 'КАТЕГОРИЯ', 'N1', 206)],
      [line(567, 'Технически допустимая максимальная масса', '3000', 206), line(277, '- рабочий объем цилиндров,', '2000', 206)]
    ]
  };
  const vehicle = parseVehicleDocument(document);
  assert.deepEqual(calculateUtil(vehicle, new Date('2026-09-21T00:00:00Z')), [
    { age: 'new', commercial: 990000, personal: 990000, pickup: true, utilCoefficient: 6.6 }
  ]);
});

test('parses SБКТС and adds every 30-minute electric power', () => {
  const document = {
    text: [
      'СВИДЕТЕЛЬСТВО О БЕЗОПАСНОСТИ КОНСТРУКЦИИ ТРАНСПОРТНОГО СРЕДСТВА',
      'Гибридное транспортное средство параллельного типа.',
      'Двигатель внутреннего сгорания (марка, тип) TEST',
      '- максимальная мощность, кВт 115 (5500)',
      'Электромашина (марка, тип) TEST 1, TEST 2',
      'Максимальная 30-минутная 90',
      'мощность, кВт',
      '36',
      'Дата оформления " 02 " сентября 2026 г.'
    ].join('\n'),
    pages: [
      [line(476, 'МАРКА', 'TEST BRAND', 206), line(460, 'КОММЕРЧЕСКОЕ', 'TEST MODEL', 206), line(401, 'ИДЕНТИФИКАЦИОННЫЙ', 'TESTVN00000000002', 206), line(374, 'ГОД ВЫПУСКА', '2026 г.', 206), line(358, 'КАТЕГОРИЯ', 'M1', 206)],
      [line(567, 'Технически допустимая максимальная масса', '2705', 206), line(277, '- рабочий объем цилиндров,', '1498', 206), line(234, '- максимальная мощность, кВт', '115 (5500)', 206)],
      [line(658, 'Максимальная 30-минутная', '90', 206), line(631, '', '36', 206)]
    ]
  };
  const vehicle = parseVehicleDocument(document);
  assert.equal(vehicle.totalKw, 241);
  assert.equal(vehicle.vin, 'TESTVN00000000002');
  assert.equal(vehicle.hybridType, 'parallel');
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

test('treats a placeholder 30-minute power below 1 kW in SBKTS as zero', () => {
  const document = {
    text: [
      'СВИДЕТЕЛЬСТВО О БЕЗОПАСНОСТИ КОНСТРУКЦИИ ТРАНСПОРТНОГО СРЕДСТВА',
      'Гибридное транспортное средство параллельного типа.',
      'Двигатель внутреннего сгорания (марка, тип) B58B30',
      '- максимальная мощность, кВт 280 (5000)',
      'Электромашина (марка, тип) отсутствует',
      'Максимальная 30-минутная мощность, кВт 0,0001',
      'Дата оформления " 20 " сентября 2026 г.'
    ].join('\n'),
    pages: [
      [line(476, 'МАРКА', 'BMW', 206), line(460, 'КОММЕРЧЕСКОЕ', 'X6 XDRIVE40I M SPORT', 206), line(401, 'ИДЕНТИФИКАЦИОННЫЙ', 'TESTVN00000000003', 206), line(374, 'ГОД ВЫПУСКА', '2024 г.', 206), line(358, 'КАТЕГОРИЯ', 'M1', 206)],
      [line(567, 'Технически допустимая максимальная масса', '2900', 206), line(277, '- рабочий объем цилиндров,', '2998', 206), line(234, '- максимальная мощность, кВт', '280 (5000)', 206)]
    ]
  };
  const vehicle = parseVehicleDocument(document);
  assert.equal(vehicle.hybridType, 'parallel');
  assert.deepEqual(vehicle.electricKw, [0]);
  assert.equal(vehicle.electric30MinKw, 0);
  assert.equal(vehicle.totalKw, 280);
});

test('accepts common Russian date formats', () => {
  for (const value of ['02.09.2026', '2/9/26', '2026-09-02', '2 сентября 2026', 'сентябрь 2, 2026']) {
    assert.equal(toIso(parseFlexibleDate(value)), '2026-09-02');
  }
  assert.equal(parseFlexibleDate('31.02.2026'), null);
});
