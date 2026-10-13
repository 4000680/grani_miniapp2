import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calculateUtil, calculatePeniForecast, addWorkingDays, parseFlexibleDate, toIso } from '../src/document-processing.js';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function extract(name, async = false) {
  const start = source.indexOf(`${async ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const date = value => new Date(`${value}T00:00:00Z`);
const plain = value => JSON.parse(JSON.stringify(value));
const util = [{ age:'new', personal:3400, commercial:800800 }];

function runtime() {
  let state = null;
  const sent = [], saved = [];
  const context = vm.createContext({
    ageLabel: age => age === 'new' ? 'до 3 лет' : 'старше 3 лет',
    formatMoney: n => `${n.toFixed(2)} ₽`, formatDate: toIso,
    calculatePeniForecast, addWorkingDays, parseFlexibleDate,
    todayUtc: () => date('2026-09-30'), nextDay: d => new Date(d.getTime()+86400000),
    getCustomsState: async()=>state, setCustomsState:async(_env,_id,next)=>{state=next;},
    clearCustomsState:async()=>{state=null;}, cleanupTemporaryMessages:async()=>{},
    trackTemporaryMessage:async()=>{}, escapeHtml:value=>value,
    formatKw:n=>`${n} кВт`, formatPower:n=>`${n} кВт`,
    calculationNavigationKeyboard:()=>({}), calculationResultKeyboard:()=>({}),
    telegram:async(_env,method,payload)=>{sent.push({method,payload});return {message_id:10};},
    saveApplication:async(_env,_id,app,text)=>saved.push({app,text})
  });
  vm.runInContext(['peniCases','encodeCases','extractCases','formatPeniCompact','formatDocumentResult'].map(name=>extract(name)).join('\n') +
    '\n' + extract('sendIssueDatePrompt',true) + '\n' + extract('handleDateReply',true),context);
  // Real Telegram text has integer money amounts for the initial date prompt.
  context.formatMoney=n=>`${Math.round(n).toLocaleString('ru-RU')} ₽`;
  return {context,sent,saved,state:()=>state};
}

test('document penalty cases include both available rates with explicit labels', () => {
  const {context}=runtime();
  assert.deepEqual(plain(context.peniCases(util)),[
    {label:'до 3 лет — льготный утильсбор',sum:3400},
    {label:'до 3 лет — коммерческий утильсбор',sum:800800}
  ]);
});

test('N1 van result includes mass-based commercial util and both penalty dates', () => {
  const {context}=runtime();
  const vehicle={type:'sbkts',brand:'TEST',model:'VAN',year:2020,category:'N1',maxMass:3500,cargoType:'van',ccm:2143,issueDate:date('2026-09-01')};
  const fees=calculateUtil(vehicle,date('2026-09-30'));
  const text=context.formatDocumentResult(vehicle,fees,addWorkingDays(vehicle.issueDate,5),date('2026-09-30'));
  assert.match(text,/N1/);
  assert.match(text,/3500 кг/);
  assert.match(text,/9.61/);
  assert.match(text,/1\s*441\s*500/);
  assert.match(text,/Сегодня/);
  assert.match(text,/Следующий рабочий день/);
  assert.equal(context.peniCases(fees).length,1);
});

test('commercial-only vehicles and cargo do not duplicate the same rate', () => {
  const {context}=runtime();
  for(const cargo of [false,true]) {
    const cases=context.peniCases([{age:'old',personal:2808000,commercial:2808000,cargo}]);
    assert.equal(cases.length,1);
    assert.equal(cases[0].sum,2808000);
    assert.match(cases[0].label,/коммерческий/);
  }
});

test('unknown exact age retains four independent age/rate alternatives', () => {
  const {context}=runtime();
  const cases=context.peniCases([...util,{age:'old',personal:5200,commercial:1408800}]);
  assert.equal(cases.length,4);
  assert.deepEqual(plain(cases.map(x=>x.sum)),[3400,800800,5200,1408800]);
  assert.deepEqual(plain(context.extractCases(context.encodeCases(cases))),plain(cases));
});

test('date prompt preserves both rate labels and supports older prompt formats', () => {
  const {context}=runtime();
  const cases=context.peniCases(util);
  assert.deepEqual(plain(context.extractCases(context.encodeCases(cases))),plain(cases));
  assert.deepEqual(plain(context.extractCases('до 3 лет: 3 400 ₽\nстарше 3 лет: 5 200 ₽')),[
    {label:'до 3 лет',sum:3400},{label:'старше 3 лет',sum:5200}
  ]);
  assert.deepEqual(plain(context.extractCases('Сумма утильсбора: 800 800 ₽')),[{label:'',sum:800800}]);
});

test('automatic penalties show both rates for today and the next working day', () => {
  const {context}=runtime();
  context.formatMoney=n=>n.toFixed(2);
  const cases=context.peniCases(util);
  const text=context.formatPeniCompact(cases,date('2026-09-11'),date('2026-09-30'));
  for(const item of cases) {
    assert.ok(text.includes(item.label));
    for(const result of calculatePeniForecast(item.sum,date('2026-09-11'),date('2026-09-30'))) {
      assert.ok(text.includes(result.total.toFixed(2)));
      assert.ok(text.includes((item.sum+result.total).toFixed(2)));
    }
  }
  assert.equal((text.match(/Сегодня,/g)||[]).length,2);
  assert.equal((text.match(/Следующий рабочий день,/g)||[]).length,2);
});

test('SBKTS and EPTS result cards with a known date include both rate forecasts', () => {
  const {context}=runtime();
  for(const type of ['sbkts','epts']) {
    const vehicle={type,brand:'TEST',model:'CAR',category:'M1',year:2026,ccm:1995,
      combustionKw:110,totalKw:110,hybridType:'combustion',issueDate:date('2026-09-04')};
    const text=context.formatDocumentResult(vehicle,util,date('2026-09-11'),date('2026-09-30'));
    assert.match(text,/льготный утильсбор/);
    assert.match(text,/коммерческий утильсбор/);
    assert.equal((text.match(/Сегодня,/g)||[]).length,2);
    assert.equal((text.match(/Следующий рабочий день,/g)||[]).length,2);
  }
});

test('EPTS date entry flow calculates and saves both rates, not their combined debt', async () => {
  for(const withReply of [true,false]) {
    const {context,sent,saved}=runtime();
    const cases=context.peniCases(util);
    await context.sendIssueDatePrompt({},1,cases);
    const message={chat:{id:1},from:{id:1},text:'4 сентября 2026'};
    if(withReply)message.reply_to_message={text:sent[0].payload.text};
    assert.equal(await context.handleDateReply({},message),true);
    const text=sent.at(-1).payload.text;
    assert.match(text,/льготный утильсбор/);
    assert.match(text,/коммерческий утильсбор/);
    assert.equal((text.match(/Сегодня,/g)||[]).length,2);
    assert.equal(saved[0].app.amount,null);
  }
});
