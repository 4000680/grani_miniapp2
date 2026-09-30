import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { calculatePeniForecast, addWorkingDays, toIso } from '../src/document-processing.js';

const date = value => new Date(`${value}T00:00:00Z`);
const forecast = today => calculatePeniForecast(2808000, date('2026-09-11'), date(today));

test('сегодня и следующий будний: контрольные пени 30 сентября и 1 октября', () => {
  const results = forecast('2026-09-30');
  assert.deepEqual(results.map(r => toIso(r.date)), ['2026-09-30', '2026-10-01']);
  assert.deepEqual(results.map(r => r.days), [19, 20]);
  assert.deepEqual(results.map(r => Math.round(r.total * 100) / 100), [24897.6, 26208]);
});

test('пятница и выходные переходят к понедельнику, пени включают выходные', () => {
  for (const today of ['2026-09-25', '2026-09-26', '2026-09-27']) {
    assert.equal(toIso(forecast(today)[1].date), '2026-09-28');
    assert.equal(forecast(today)[1].days, 17);
  }
});

test('следующий рабочий день пропускает официальный праздник РФ', () => {
  assert.equal(toIso(forecast('2026-11-03')[1].date), '2026-11-05');
  assert.equal(toIso(forecast('2026-06-11')[1].date), '2026-06-15');
});

test('до срока ноль, на следующем рабочем дне учитывается начало просрочки', () => {
  assert.deepEqual(forecast('2026-09-10').map(r => r.total), [0, 0]);
  const results = forecast('2026-09-11');
  assert.deepEqual(results.map(r => r.days), [0, 3]);
  assert.equal(Math.round(results[1].total * 100) / 100, 3931.2);
  assert.equal(toIso(addWorkingDays(date('2026-09-04'), 5)), '2026-09-11');
});

test('итог Telegram содержит обе даты и суммы для каждого варианта', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function formatPeniCompact('), source.indexOf('function documentAgePrompt('));
  const format = runInNewContext(`${body}; formatPeniCompact`, {
    calculatePeniForecast, formatDate: toIso, formatMoney: n => n.toFixed(2),
    nextDay: d => new Date(d.getTime() + 86400000)
  });
  const text = format([{label: 'до 3 лет', sum: 2808000}, {label: 'старше 3 лет', sum: 100000}], date('2026-09-11'), date('2026-09-30'));
  assert.match(text, /Сегодня, 2026-09-30/);
  assert.match(text, /Следующий рабочий день, 2026-10-01/);
  assert.match(text, /24897\.60/);
  assert.match(text, /26208\.00/);
  assert.match(text, /2832897\.60/);
  assert.match(text, /2834208\.00/);
  assert.match(text, /старше 3 лет/);
});
