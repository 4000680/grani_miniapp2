import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { categoryConfirmationReason, cargoCategoryForMass, pickupBodyHint, vehicleCategoryOptions, VEHICLE_BODY_REGISTRY } from '../../shared/vehicle-category.js';
import { calculateUtil } from '../src/document-processing.js';
import { isPermanentResultText } from '../src/message-policy.js';

test('reviewed body hints are brand-specific and never confuse SUVs, vans or motorcycles', () => {
  for (const [brand, model] of [['Toyota','Hilux Surf'],['Hino','Ranger'],['Suzuki','Jimny Sierra'],['Royal Enfield','Hunter 350'],['GMC','Savana 2500'],['RAM','Promaster 3500'],['Ssangyong','Musso'],['BESTUNE','T90']]) {
    assert.equal(pickupBodyHint({brand, model}), null, `${brand} ${model}`);
  }
  for (const [brand, model] of [['Toyota','Hilux'],['Ford','F-150 Raptor R'],['RAM','1500 TRX'],['Mitsubishi','L200 Sportero'],['JAC','T9 Hunter'],['Hyundai','Santa Cruz'],['Tesla','Cybertruck']]) {
    assert.ok(pickupBodyHint({brand,model}), `${brand} ${model}`);
  }
  for (const record of VEHICLE_BODY_REGISTRY.records) {
    assert.match(record.source, /^https:\/\//);
    assert.ok(record.reviewedAt);
  }
});

test('only reviewed pickups and mass strictly over 5 tonnes trigger confirmation; documents win', () => {
  assert.equal(categoryConfirmationReason({type:'catalog',brand:'Mercedes-Benz',model:'GLS 580',maxMass:3598}),null);
  assert.equal(categoryConfirmationReason({type:'catalog',brand:'Toyota',model:'Hilux',maxMass:2500}),'pickup');
  assert.equal(categoryConfirmationReason({type:'catalog',maxMass:5000}),null);
  assert.equal(categoryConfirmationReason({type:'catalog',maxMass:5001}),'mass');
  for (const type of ['sbkts','epts']) assert.equal(categoryConfirmationReason({type,category:'M1',brand:'Ford',model:'Ranger',maxMass:6000}),null);
});

test('cargo category boundaries do not confuse the 5-tonne prompt with legal thresholds', () => {
  for (const [mass,category] of [[2500,'N1'],[3500,'N1'],[3501,'N2'],[5000,'N2'],[12000,'N2'],[12001,'N3'],[0,null],[undefined,null],['bad',null]]) {
    assert.equal(cargoCategoryForMass(mass),category);
  }
});

const source = fs.readFileSync(new URL('../src/index.js', import.meta.url),'utf8');
const functions = source.slice(source.indexOf('async function handleCatalogCallback('),source.indexOf('async function handleDocument('));
function flow(candidate) {
  let state = null;
  const sent=[], saved=[];
  const context = vm.createContext({
    categoryConfirmationReason, vehicleCategoryOptions, calculateUtil, isPermanentResultText,
    getCustomsState:async()=>state,
    setCustomsState:async(_env,_id,next)=>{state=next;},
    catalogQueryFromNavigationMessage:()=>null, withCustomsState:x=>x,
    loadCatalog:async()=>({}),getCatalogCandidateForUser:async()=>({...candidate}),
    calculationPower:()=>100,
    telegram:async(_env,method,payload)=>{sent.push({method,payload});return {message_id:77};},
    trackTemporaryMessage:async()=>{}, releaseTemporaryMessage:async()=>{},
    catalogCandidateDescription:()=>candidate.brand+' '+candidate.model,
    formatCatalogResult:(_candidate,vehicle,util)=>JSON.stringify({category:vehicle.category,util}),
    catalogCalculationResultKeyboard:()=>({}), saveUtilYearContext:async()=>{},
    saveApplication:async(_env,_id,app)=>saved.push(app), applicationFromVehicle:(vehicle,util)=>({vehicle,util}),
    cargoTypePrompt:(vehicle,candidates)=>({text:'choose cargo type',reply_markup:{inline_keyboard:[...candidates.map(item=>[{text:item.label,callback_data:`calc:cargo:${item.id}`}]),[{text:'back'},{text:'menu'}]]}})
  });
  vm.runInContext(functions,context);
  const press=async(data,text='working card')=>context.handleCatalogCallback({}, {data,from:{id:1},message:{chat:{id:1},message_id:2,text}});
  return {context,press,sent,saved,state:()=>state};
}
const candidate = {rowIndex:0,brand:'Toyota',model:'Hilux',year:2026,mass:3100,combustionKw:100};

test('Telegram pickup flow asks, applies N1 mass rate, archives selected category; passenger alternative still works', async () => {
  const f=flow(candidate);
  await f.press('catalog:calc:0:2000:3100');
  assert.equal(f.saved.length,0);
  assert.equal(f.state().stage,'category');
  const buttons=f.sent.at(-1).payload.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(x=>x.callback_data==='catalog:category:0:2000:3100:N1'));
  assert.ok(buttons.some(x=>x.callback_data==='calc:menu'));
  await f.press('catalog:category:0:2000:3100:N1');
  assert.equal(f.saved[0].vehicle.category,'N1');
  assert.equal(f.saved[0].util[0].cargo,true);
  assert.equal(f.saved[0].util[0].commercial,calculateUtil({...f.saved[0].vehicle,category:'N1'})[0].commercial);
  const passenger=flow(candidate);
  await passenger.press('catalog:category:0:2000:3100:M1');
  assert.equal(passenger.saved[0].vehicle.category,'M1');
  assert.equal(passenger.saved[0].util[0].cargo,undefined);
});

test('Telegram ordinary passenger avoids prompt; changing category preserves final result', async () => {
  const f=flow({...candidate,model:'Camry',mass:2100});
  await f.press('catalog:calc:0:2000:2100');
  assert.equal(f.saved.length,1);
  assert.equal(f.saved[0].vehicle.category,'M1');
  await f.press('catalog:category:0:2000:2100:choose','✅ Расчёт утильсбора');
  assert.equal(f.sent.at(-1).method,'sendMessage');
});

test('Telegram heavy cargo offers only matching N2/N3 and requests existing subtype choices', async () => {
  for (const [mass,category] of [[9000,'N2'],[18000,'N3']]) {
    const f=flow({...candidate,brand:'ACME',model:'Truck',mass});
    await f.press(`catalog:calc:0:2000:${mass}`);
    const options=f.sent.at(-1).payload.reply_markup.inline_keyboard.flat().map(x=>x.callback_data);
    assert.ok(options.includes(`catalog:category:0:2000:${mass}:${category}`));
    await f.press(`catalog:category:0:2000:${mass}:${category}`);
    if (category === 'N2') {
      assert.equal(f.state().stage,'result');
      assert.equal(f.saved[0].vehicle.category,'N2');
      assert.equal(f.saved[0].util[0].cargo,true);
      continue;
    }
    assert.equal(f.state().stage,'cargo-type');
    assert.ok(f.state().cargoCandidates.length>1);
    assert.equal(f.state().vehicle.category,category);
    const vehicle={...f.state().vehicle,cargoType:f.state().cargoCandidates[0].id};
    await f.context.completeCatalogUtil({}, {from:{id:1},message:{chat:{id:1},message_id:2}},f.state().catalogCandidate,vehicle);
    assert.equal(f.saved[0].vehicle.category,category);
    assert.equal(f.saved[0].util[0].cargo,true);
  }
});

test('category callbacks cannot assign an incompatible cargo category', async () => {
  const f=flow(candidate);
  await f.press('catalog:category:0:2000:3100:N3');
  assert.equal(f.saved.length,0);
});
