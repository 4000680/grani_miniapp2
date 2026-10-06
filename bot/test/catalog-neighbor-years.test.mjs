import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import {listCatalogNeighborYears, listCatalogModifications, getCatalogCandidate, applyCatalogTemplateChoice, parseCatalogQuery, calculationPower} from '../src/catalog-search.js';

const catalog = {brands:['ALPHA'], models:['VAN L2H2','VAN L3H2','VAN'], rows:[
  [0,0,2023,0,92,0,3500], [0,0,2025,0,100,0,3600], [0,0,2021,0,90,0,3400],
  [0,1,2024,0,110,0,3500], [0,2,2024,0,120,0,3500]
]};

test('missing year offers only the same complete modification within one year', () => {
  const found=listCatalogNeighborYears(catalog,parseCatalogQuery('ALPHA VAN L2H2 2024'));
  assert.deepEqual(found.map(x=>[x.model,x.year]), [['VAN L2H2',2025],['VAN L2H2',2023]]);
  assert.equal(listCatalogNeighborYears(catalog,parseCatalogQuery('ALPHA VAN L3H2 2024')).length,0);
  assert.equal(listCatalogNeighborYears(catalog,parseCatalogQuery('ALPHA VAN L2H2')).length,0);
  assert.equal(listCatalogNeighborYears(catalog,parseCatalogQuery('ALPHA VAN L2H2 2028')).length,0);
});

test('choosing a neighboring template preserves the actual vehicle year and raw catalog', () => {
  const raw=getCatalogCandidate(catalog,0);
  const choice={brandIndex:0,modelIndex:0,templateYear:2023,vehicleYear:2024};
  const selected=applyCatalogTemplateChoice(raw,choice);
  assert.equal(selected.year,2024);
  assert.equal(selected.templateYear,2023);
  assert.equal(selected.combustionKw,92);
  assert.equal(selected.mass,3500);
  assert.equal(raw.year,2023);
  assert.equal(applyCatalogTemplateChoice(getCatalogCandidate(catalog,3),choice).year,2024);
});

const source=fs.readFileSync(new URL(process.env.GRANI_NEIGHBOR_WORKER || '../src/index.js',import.meta.url),'utf8');
function extract(name){const start=source.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);const end=source.indexOf('\n}',start)+2;return source.slice(start,end);}

test('bot explains year mismatch and routes the template through an explicit choice', () => {
  const context={escapeHtml:x=>x,compactButtonText:x=>x,catalogNavigationLine:()=>'',getCatalogCandidate,applyCatalogTemplateChoice};
  vm.createContext(context);
  vm.runInContext(extract('catalogSuggestionsText')+'\n'+extract('catalogSuggestionsKeyboard'),context);
  const items=listCatalogNeighborYears(catalog,parseCatalogQuery('ALPHA VAN L2H2 2024')).map(x=>({...x,neighborYear:true,vehicleYear:2024}));
  const text=context.catalogSuggestionsText(items,{year:2024});
  assert.match(text,/Год выпуска вашего автомобиля остаётся 2024/);
  assert.match(text,/предварительным/);
  const buttons=context.catalogSuggestionsKeyboard(items).inline_keyboard;
  assert.equal(buttons[0][0].callback_data,'catalog:neighbor:0:0:2025:2024');
  assert.match(buttons[0][0].text,/2025/);
  assert.match(buttons.at(-1)[1].text,/Главное меню/);
});

test('live Renault control query offers L2H2 2023, never substitutes L3H2', () => {
  const encoded=fs.readFileSync(new URL('../../tabs/utilsbor/spravochnik.json.gz.b64',import.meta.url),'utf8').trim();
  const live=JSON.parse(zlib.inflateSync(Buffer.from(encoded,'base64')));
  const query=parseCatalogQuery('Renault Master L2H2 2024');
  if(listCatalogModifications(live,query).length) return; // An hourly update may add the exact year.
  const found=listCatalogNeighborYears(live,query);
  assert.ok(found.some(x=>x.model==='MASTER L2H2'&&x.year===2023));
  assert.ok(found.every(x=>x.model==='MASTER L2H2'&&Math.abs(x.year-2024)===1));
});

test('candidate reads and row-state transitions keep the original year throughout callbacks', async () => {
  let state={catalogTemplateChoice:{brandIndex:0,modelIndex:0,templateYear:2023,vehicleYear:2024}};
  const stub={getCustomsState:async()=>state,setCustomsState:async next=>{state=next;}};
  const context={applicationsStub:()=>stub,getCustomsState:async()=>state,getCatalogCandidate,applyCatalogTemplateChoice};
  vm.createContext(context);
  vm.runInContext(extract('setCustomsState')+'\n'+extract('getCatalogCandidateForUser'),context);
  await context.setCustomsState({},1,{stage:'under3-selected-volume',rowIndex:0});
  assert.equal((await context.getCatalogCandidateForUser({},catalog,0,1)).year,2024);
  await context.setCustomsState({},1,{rowIndex:0,catalogTemplateChoice:null});
  assert.equal((await context.getCatalogCandidateForUser({},catalog,0,1)).year,2023);
});

test('neighbor choice followed by volume calculation uses vehicle year, not template year', async () => {
  let state=null, completed;
  const parsed=parseCatalogQuery('ALPHA VAN L2H2 2024');
  const context={
    getCustomsState:async()=>state, setCustomsState:async(_env,_id,next)=>{state=next;},
    withCustomsState:x=>x,catalogQueryFromNavigationMessage:()=>parsed,
    loadCatalog:async()=>catalog,listCatalogNeighborYears,getCatalogCandidate,applyCatalogTemplateChoice,
    showCatalogModification:async()=>{},calculationPower,
    calculateUtil:vehicle=>{assert.equal(vehicle.year,2024);return [];},
    formatCatalogResult:(candidate,vehicle)=>{completed={candidate,vehicle};return 'result';},
    catalogCalculationResultKeyboard:()=>({}),telegram:async()=>({}),
    saveUtilYearContext:async()=>{},saveApplication:async()=>{},applicationFromVehicle:()=>({}),releaseTemporaryMessage:async()=>{}
  };
  vm.createContext(context);
  vm.runInContext(extract('getCatalogCandidateForUser')+'\n'+extract('handleCatalogCallback'),context);
  const query={from:{id:1},message:{chat:{id:1},message_id:2,text:'source'}};
  await context.handleCatalogCallback({}, {...query,data:'catalog:neighbor:0:0:2023:2024'});
  await context.handleCatalogCallback({}, {...query,data:'catalog:calc:0:2500:3500'});
  assert.equal(completed.candidate.templateYear,2023);
  assert.equal(completed.candidate.year,2024);
  assert.equal(completed.vehicle.year,2024);
});
