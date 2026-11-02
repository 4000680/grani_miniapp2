import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {findDeclarationPrice} from '../src/declaration-flow.js';
import {listCatalogBaseModels,listCatalogBrandModels,parseCatalogQuery} from '../src/catalog-search.js';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('base template proposals preserve brand, year and model numbers without automatic matching',()=>{
  const catalog={brands:['ALPHA','BETA'],models:['ROAD','ROAD 2','ROAD 3'],rows:[
    [0,0,2026,-1,110,0,1900],[0,0,2025,-1,100,0,1800],
    [0,1,2026,-1,120,0,2000],[1,2,2026,-1,150,0,2500]
  ]};
  assert.deepEqual(listCatalogBaseModels(catalog,parseCatalogQuery('ALPHA ROAD SPORT 2026')).map(x=>[x.brand,x.model,x.year]),[['ALPHA','ROAD',2026]]);
  assert.deepEqual(listCatalogBaseModels(catalog,parseCatalogQuery('ALPHA ROAD 3 SPORT 2026')),[]);
  assert.deepEqual(listCatalogBaseModels(catalog,parseCatalogQuery('ALPHA ROAD 2026')),[]);
  assert.ok(listCatalogBrandModels(catalog,parseCatalogQuery('ALPHA ROAD SPORT 2026')).every(x=>x.year===2026&&x.brand==='ALPHA'));
});

test('Ceed finds both full coded modifications with prices, never a base exact match',()=>{
  const found=findDeclarationPrice('Kia Ceed');
  assert.equal(found.exact,null);
  assert.deepEqual(found.closest.map(x=>[x.name,x.price]),[
    ['KIA CEED J7W5D261FH/H0M9',1062269.78],['KIA CEED J7W5D261FK/K217',1049518.1]
  ]);
});

test('all coded modifications remain available on pages instead of dropping later entries',()=>{
  const rows=Array.from({length:19},(_,i)=>({name:`ALPHA ROAD CODE${i}`,price:100000+i}));
  assert.equal(findDeclarationPrice('ALPHA ROAD',rows).closest.length,19);
});

test('declaration selection displays complete names and prices and preserves laboratory warning',async()=>{
  let state={mode:'declaration',stage:'fts-name',vehicle:{brand:'KIA',model:'CEED'}};
  const messages=[];
  const context=vm.createContext({
    getCustomsState:async()=>state,setCustomsState:async(_env,_id,next)=>{state=next;},
    findDeclarationPrice,telegram:async(_env,method,payload)=>{messages.push({method,...payload});return {message_id:messages.length};},
    trackTemporaryMessage:async()=>{},escapeHtml:String,formatMoney:String
  });
  vm.runInContext(source.slice(source.indexOf('function declarationKeyboard('),source.indexOf('async function sendCalculationStart(')),context);
  await context.handleDeclarationReply({}, {chat:{id:123},from:{id:123},text:'Kia Ceed'});
  assert.equal(state.stage,'price-choice');assert.equal(state.priceRub,undefined);
  for(const item of state.closest) {
    assert.ok(messages.at(-1).text.includes(item.name));assert.ok(messages.at(-1).text.includes(String(item.price)));
  }
  assert.match(messages.at(-1).text,/письмо лаборатории/);
  const keys=messages.at(-1).reply_markup.inline_keyboard.flat();
  assert.equal(keys.filter(x=>/^declaration:price:/.test(x.callback_data)).length,2);
  await context.handleDeclarationCallback({}, {data:'declaration:price:1',from:{id:123},message:{chat:{id:123},message_id:1}});
  assert.equal(state.priceRub,1049518.1);assert.equal(state.nameClarificationRequired,true);
  assert.match(messages.at(-1).text,/письмо лаборатории/);
  assert.doesNotMatch(messages.at(-1).text,/Точное совпадение найдено/);
  const output=context.declarationResultText; // Full final formatter is tested with its normal dependencies below.
  assert.equal(typeof output,'function');
});

test('final formatter keeps selected full price name and warning',()=>{
  const context=vm.createContext({DECLARATION_COUNTRIES:{KZ:{label:'Казахстан',currency:'KZT'}},escapeHtml:String,
    formatMoney:String,formatCurrencyAmount:String,formatPower:String,ageLabel:()=> 'до 3 лет'});
  vm.runInContext(source.slice(source.indexOf('function declarationKeyboard('),source.indexOf('async function sendCalculationStart(')),context);
  const text=context.declarationResultText({country:'KZ',vehicle:{brand:'KIA',model:'CEED'},ftsName:'KIA CEED',
    priceName:'KIA CEED FULL CODE',nameClarificationRequired:true,paidDuty:0,paidVat:0,paidDutyRub:0,paidVatRub:0},
    {calculationYear:2026,price:1000,duty:150,excise:0,vat:253,util:[]});
  assert.match(text,/KIA CEED FULL CODE/);assert.match(text,/письмо лаборатории/);
});
