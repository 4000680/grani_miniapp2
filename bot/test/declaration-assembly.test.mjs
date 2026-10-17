import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {calculateDeclarationPayment, DECLARATION_COUNTRIES} from '../src/declaration-flow.js';
import {parseCurrencyAmount,convertCurrencyToRub} from '../src/customs-calculation.js';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const vehicle={brand:'ACME',model:'AX12',category:'M1',year:2026,ccm:1998,totalKw:126,maxMass:2150,hybridType:'combustion'};
function harness(initial={}) {
  let state={mode:'declaration',stage:'country',vehicle,priceRub:2000000,ftsName:'ACME AX12',...initial};
  const messages=[],saved=[],rates=[];
  const context=vm.createContext({
    DECLARATION_COUNTRIES,calculateDeclarationPayment,parseCurrencyAmount,convertCurrencyToRub,
    getCustomsState:async()=>state,
    setCustomsState:async(_env,_id,next)=>{state=next;},
    telegram:async(_env,method,payload)=>{messages.push({method,...payload});return {message_id:messages.length};},
    trackTemporaryMessage:async()=>{},saveApplication:async(...args)=>saved.push(args),
    applicationFromVehicle:()=>({}),escapeHtml:String,formatMoney:String,
    formatCurrencyAmount:(value,code)=>`${value} ${code}`,formatPower:String,ageLabel:()=> 'до 3 лет',
    formatCbrRate:rate=>`Курс ${rate.code}`,
    cbrCurrencyRate:async code=>{rates.push(code);return {code,unitRate:2,nominal:1,value:2};}
  });
  vm.runInContext(source.slice(source.indexOf('function declarationKeyboard('),source.indexOf('async function sendCalculationStart(')),context);
  const callback=data=>context.handleDeclarationCallback({}, {data,from:{id:123},message:{chat:{id:123},message_id:1}});
  const reply=text=>context.handleDeclarationReply({}, {text,from:{id:123},chat:{id:123}});
  return {state:()=>state,messages,saved,rates,callback,reply};
}
function buttons(message){return message.reply_markup.inline_keyboard.flat();}

test('assembly buttons are country-specific and keep navigation at payment prompts',async()=>{
  for(const [country,label] of [['KZ','Казахская сборка'],['BY','Белорусская сборка'],['KG',null],['AM',null]]) {
    const h=harness();await h.callback(`declaration:country:${country}`);
    assert.equal(h.state().stage,'paid-duty');
    const keys=buttons(h.messages.at(-1));
    assert.equal(keys.some(button=>button.text===label),Boolean(label));
    assert.equal(keys.filter(button=>button.callback_data.startsWith('declaration:assembly:')).length,label?1:0);
    assert.ok(keys.some(button=>button.text==='← Назад'));
    assert.ok(keys.some(button=>button.callback_data==='calc:menu'));
  }
});

test('both assembly choices zero both payments, skip CBR and save the complete original formula',async()=>{
  for(const country of ['KZ','BY']) {
    const h=harness({stage:'paid-duty',country,paidDuty:900,paidVat:800,paidDutyRub:1800,paidVatRub:1600,currencyRate:{code:'OLD',unitRate:2}});
    await h.callback(`declaration:assembly:${country}`);
    const state=h.state();assert.equal(state.stage,'result');
    assert.equal(state.localAssembly,country);
    for(const field of ['paidDuty','paidVat','paidDutyRub','paidVatRub'])assert.equal(state[field],0);
    assert.equal(state.currencyRate,null);assert.deepEqual(h.rates,[]);
    const expected=calculateDeclarationPayment({...state,calculationYear:2026});
    for(const item of expected.util) {
      assert.equal(item.dutyDifference,expected.duty);
      assert.equal(item.vatDifference,expected.vat);
      assert.equal(item.total,expected.duty+expected.vat+expected.excise+item.amount);
      assert.ok(h.messages.at(-1).text.includes(`Итого к оплате: ${item.total}`));
    }
    assert.match(h.messages.at(-1).text,/по выбору пользователя/);
    assert.doesNotMatch(h.messages.at(-1).text,/Курс/);
    assert.equal(h.saved.length,1);
    assert.equal(h.saved[0][3],h.messages.at(-1).text);
    assert.ok(buttons(h.messages.at(-1)).some(button=>button.callback_data==='declaration:back:paid-vat'));
    assert.ok(buttons(h.messages.at(-1)).some(button=>button.callback_data==='declaration:result:year:2027'));
    await h.callback(`declaration:assembly:${country}`);
    assert.equal(h.saved.length,1,'repeated completed click is ignored');
  }
});

test('zero input works for both payments without changing price parsing',async()=>{
  for(const zero of ['0','0,00','0.000']) {
    const h=harness({stage:'paid-duty',country:'KZ'});
    await h.reply(zero);assert.equal(h.state().stage,'paid-vat');
    assert.ok(buttons(h.messages.at(-1)).some(button=>button.text==='Казахская сборка'));
    await h.reply(zero);assert.equal(h.state().stage,'result');
    assert.equal(h.state().paidDutyRub,0);assert.equal(h.state().paidVatRub,0);
    assert.deepEqual(h.rates,[]);assert.equal(h.saved.length,1);
  }
  assert.equal(parseCurrencyAmount('0'),null,'vehicle price parser must still reject zero');
});

test('invalid and negative inputs stay at the payment prompt with assembly and navigation',async()=>{
  for(const input of ['', '-1','-0','нет','NaN']) {
    const h=harness({stage:'paid-duty',country:'BY'});await h.reply(input);
    assert.equal(h.state().stage,'paid-duty');assert.equal(h.saved.length,0);
    assert.ok(buttons(h.messages.at(-1)).some(button=>button.text==='Белорусская сборка'));
  }
});

test('stale or mismatched assembly callbacks cannot change other countries or flows',async()=>{
  for(const state of [
    {country:'KG',stage:'paid-duty'},{country:'AM',stage:'paid-vat'},
    {country:'BY',stage:'paid-duty'},{country:'KZ',stage:'country'},
    {country:'KZ',stage:'result'},{country:'KZ',stage:'paid-duty',mode:'util'}
  ]) {
    const h=harness(state),before=h.state();await h.callback('declaration:assembly:KZ');
    assert.equal(h.state(),before);assert.equal(h.saved.length,0);assert.equal(h.messages.length,0);
  }
});

test('back, manual correction and country changes do not keep a stale assembly or exchange rate',async()=>{
  const h=harness({stage:'paid-duty',country:'KZ'});
  await h.callback('declaration:assembly:KZ');
  await h.callback('declaration:back:paid-vat');assert.equal(h.state().stage,'paid-vat');
  await h.reply('100');assert.equal(h.state().localAssembly,null);
  assert.equal(h.state().paidVatRub,200);assert.deepEqual(h.rates,['KZT']);
  await h.callback('declaration:back:paid-vat');
  await h.callback('declaration:back:country');assert.equal(h.state().stage,'country');
  await h.callback('declaration:assembly:KZ');assert.equal(h.state().stage,'country');
  await h.callback('declaration:country:BY');assert.equal(h.state().currencyRate,null);
  assert.equal(h.state().paidVatRub,null);assert.equal(h.state().localAssembly,null);
  await h.reply('100');await h.reply('200');
  assert.equal(h.state().paidDutyRub,200);assert.equal(h.state().paidVatRub,400);
  assert.deepEqual(h.rates,['KZT','BYN']);
});

test('assembly remains selectable at the VAT step and resets an earlier positive duty',async()=>{
  const h=harness({stage:'paid-duty',country:'BY'});
  await h.reply('100');assert.equal(h.state().paidDutyRub,200);
  await h.callback('declaration:assembly:BY');
  assert.equal(h.state().stage,'result');assert.equal(h.state().paidDutyRub,0);
  assert.equal(h.state().paidVatRub,0);
});
