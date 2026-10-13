import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
function extract(name) {
  const start=source.indexOf('async function '+name+'(');
  assert.ok(start>=0);
  return source.slice(start,source.indexOf('\n}',start)+2);
}

test('ambiguous brand UI stops before model search and preserves original query',async()=>{
  const sent=[];
  const context={
    getCustomsState:async()=>null, cleanupTemporaryMessages:async()=>{}, trackTemporaryMessage:async()=>{},
    telegram:async(_env,method,payload)=>{sent.push({method,...payload});return {message_id:10};},
    loadCatalog:async()=>({}),resolveCatalogBrand:()=>({status:'ambiguous',candidates:[{brand:'ALPHA',brandIndex:2}]}),
    listCatalogModifications:()=>{throw new Error('must choose brand first');},
    catalogNavigationLine:p=>'Исходный запрос: '+p.vehicleText+' '+p.year,
    catalogSearchKeyboard:()=>({inline_keyboard:[[{text:'Главное меню',callback_data:'menu'}]]})
  };
  vm.createContext(context);vm.runInContext(extract('runCatalogTextSearch'),context);
  await context.runCatalogTextSearch({}, {chat:{id:1},from:{id:1}}, {vehicleText:'ALPHX VAN',year:2026});
  const result=sent.at(-1);
  assert.equal(result.method,'editMessageText');
  assert.match(result.text,/ALPHX VAN 2026/);
  assert.equal(result.reply_markup.inline_keyboard[0][0].callback_data,'catalog:brand:2');
});

test('brand callback passes preserved query and customs state into existing search',async()=>{
  let received;
  const context={getCustomsState:async()=>({mode:'under3'}),
    catalogQueryFromNavigationMessage:()=>({vehicleText:'ALPHX VAN',year:2026}),
    withCustomsState:(p,s)=>({...p,customsMode:s.mode}),loadCatalog:async()=>({}),
    selectCatalogBrandQuery:(_c,p,index)=>index===2?{...p,vehicleText:'ALPHA VAN'}:null,
    runCatalogTextSearch:async(_env,_message,p)=>{received=p;}
  };
  vm.createContext(context);vm.runInContext(extract('handleCatalogCallback'),context);
  await context.handleCatalogCallback({}, {data:'catalog:brand:2',from:{id:1},message:{chat:{id:1}}});
  assert.equal(received.vehicleText,'ALPHA VAN');
  assert.equal(received.year,2026);
  assert.equal(received.customsMode,'under3');
});
