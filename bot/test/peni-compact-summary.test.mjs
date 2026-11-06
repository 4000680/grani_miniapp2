import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {calculatePeni,calculatePeniForecast} from '../src/document-processing.js';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function formatPeniCompact('),source.indexOf('function documentAgePrompt('));
const format=vm.runInNewContext(`${body};formatPeniCompact`,{calculatePeni,calculatePeniForecast,formatDate:d=>d.toISOString().slice(0,10),formatMoney:n=>n.toFixed(2),nextDay:d=>new Date(d.getTime()+86400000)});
const date=s=>new Date(s+'T00:00:00Z');
test('compact forecast uses calendar tomorrow on Friday and omits debts, days and totals',()=>{
 const text=format([{label:'commercial',sum:100000}],date('2026-11-02'),date('2026-11-06'));
 assert.match(text,/Пени сегодня: <b>186.67<\/b>/);assert.match(text,/Пени завтра: <b>233.33<\/b>/);
 assert.doesNotMatch(text,/итого|дн\.|2026-11-09|100000|начисляться/);
});
test('before deadline both days are described as absent, with no zero figures',()=>{
 assert.equal(format([{sum:100000}],date('2026-11-09'),date('2026-11-06')),'Пени отсутствуют.');
 const text=format([{sum:100000}],date('2026-11-06'),date('2026-11-06'));
 assert.match(text,/Пени сегодня: отсутствуют/);assert.match(text,/Пени завтра: <b>46.67<\/b>/);
});
