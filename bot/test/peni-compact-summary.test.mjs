import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {calculatePeniDailySummary} from '../src/document-processing.js';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function formatPeniCompact('),source.indexOf('function documentAgePrompt('));
const format=vm.runInNewContext(`${body};formatPeniCompact`,{calculatePeniDailySummary,formatDate:d=>d.toISOString().slice(0,10),formatMoney:n=>n.toFixed(2)});
const date=s=>new Date(s+'T00:00:00Z');
test('working day shows today and one day of interest, without tomorrow or repeated totals',()=>{
 const text=format([{sum:100000}],date('2026-11-02'),date('2026-11-06'));
 assert.match(text,/Пени сегодня: <b>186.67/);assert.match(text,/За день просрочки: <b>46.67/);
 assert.doesNotMatch(text,/завтра|итого|дн\.|100000/);
});
test('weekend rolls forward to Monday and includes all intervening calendar days',()=>{
 for(const target of ['2026-11-07','2026-11-08']) {
 const text=format([{sum:100000}],date('2026-11-02'),date(target));
 assert.match(text,/Пени на 2026-11-09: <b>326.67/);assert.doesNotMatch(text,/Пени сегодня/);
 }
});
test('Russian holiday rolls forward but following working day stays unchanged',()=>{
 assert.equal(calculatePeniDailySummary(100000,date('2026-11-02'),date('2026-11-04')).date.toISOString().slice(0,10),'2026-11-05');
 assert.equal(calculatePeniDailySummary(100000,date('2026-11-02'),date('2026-11-05')).date.toISOString().slice(0,10),'2026-11-05');
});
test('before deadline displays no penalty and daily charge for a day of delay',()=>{
 const text=format([{sum:100000}],date('2026-11-09'),date('2026-11-06'));
 assert.match(text,/Пени сегодня: отсутствуют/);assert.match(text,/За день просрочки: <b>46.67/);
});
