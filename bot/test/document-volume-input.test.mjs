import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calculateUtil, DocumentProcessingError, addWorkingDays } from '../src/document-processing.js';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function extract(name, isAsync = false) {
  const start = source.indexOf(`${isAsync ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const vehicle = {type:'sbkts',brand:'TEST',model:'CAR',year:2025,category:'M1',ccm:null,
  engineMaxKw:184,combustionKw:184,totalKw:184,electricKw:[],hybridType:'combustion',issueDate:'2026-10-30T00:00:00.000Z'};
function runtime(initial) {
  let state = initial;
  const sent = [], completed = [];
  const context = vm.createContext({
    Date, Uint8Array, DocumentProcessingError, calculateUtil, addWorkingDays,
    canCheckSignature:async()=>false,
    getCustomsState:async()=>state, setCustomsState:async(_env,_id,next)=>{state=next;},
    clearCustomsState:async()=>{state=null;},
    telegram:async(_env,method,payload)=>{sent.push({method,payload});return {message_id:90};},
    finishDocumentCalculation:async(...args)=>{completed.push(args);},
    fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)}),
    processVehicleDocument:async()=>{throw new DocumentProcessingError('ENGINE_VOLUME_NOT_DETECTED','missing',null,{vehicle});},
    controlledDocumentError:e=>e,
    cleanupTemporaryMessages:async()=>{},trackTemporaryMessage:async()=>{},
    escapeHtml:s=>String(s).replaceAll('<','&lt;'), formatKw:n=>`${n} кВт`, formatPower:n=>`${n} кВт`,
  });
  vm.runInContext(['documentUploadKeyboard','documentVolumePrompt','parseDocumentEngineVolume'].map(n=>extract(n)).join('\n')+'\n'+
    ['handleDocument','handleDocumentVolumeReply'].map(n=>extract(n,true)).join('\n'),context);
  return {context,sent,completed,state:()=>state};
}
const message = text=>({from:{id:7},chat:{id:7,type:'private'},message_id:12,text});

test('missing volume prompts for cm³ and retains all previously recognized fields',async()=>{
  const r=runtime(null);
  await r.context.handleDocument({}, {...message(),document:{file_name:'test.pdf'}});
  assert.equal(r.state().stage,'document-volume');
  assert.equal(r.state().vehicle.totalKw,184);
  const prompt=r.sent.at(-1).payload;
  assert.match(prompt.text,/184 кВт/);
  assert.match(prompt.text,/см³/);
  assert.match(prompt.text,/TEST CAR/);
  assert.deepEqual(JSON.parse(JSON.stringify(prompt.reply_markup.inline_keyboard[0].map(x=>x.text))),['⬅️ Назад','🏠 Главное меню']);
  assert.equal(r.completed.length,0);
});

test('exact cm³ resumes the original calculation with power and date preserved',async()=>{
  const r=runtime({mode:'util',stage:'document-volume',vehicle,sourceMessageId:10});
  assert.equal(await r.context.handleDocumentVolumeReply({},message('1 997 см³')),true);
  assert.equal(r.completed.length,1);
  const [,original,,state,v,util,deadline]=r.completed[0];
  assert.equal(original.message_id,10);
  assert.equal(v.ccm,1997);
  assert.equal(v.totalKw,184);
  assert.ok(v.issueDate instanceof Date);
  assert.ok(deadline instanceof Date);
  assert.ok(util[0].commercial>0);
  assert.equal(state.mode,'util');
});

test('invalid, litre, range, zero and fractional input cannot cause a calculation',async()=>{
  for(const input of ['2,0','2.0 л','1000–2000','0','1997.5','1997 2000','20001','abc']){
    const r=runtime({mode:'util',stage:'document-volume',vehicle});
    await r.context.handleDocumentVolumeReply({},message(input));
    assert.equal(r.completed.length,0,input);
    assert.equal(r.state().stage,'document-volume');
    assert.match(r.sent.at(-1).payload.text,/см³/);
  }
});

test('declaration context survives manual volume entry; unrelated flows are ignored',async()=>{
  const r=runtime({mode:'declaration',stage:'document-volume',vehicle,country:'BY'});
  await r.context.handleDocumentVolumeReply({},message('1997'));
  assert.equal(r.completed[0][3].country,'BY');
  for(const state of [null,{stage:'result'},{stage:'document-volume',vehicle:{type:'epts'}}]){
    const other=runtime(state);
    assert.equal(await other.context.handleDocumentVolumeReply({},message('1997')),false);
    assert.equal(other.sent.length,0);
  }
});

test('Back cancels the pending volume so later text cannot resume the old document', async()=>{
  const r=runtime({mode:'util',stage:'document-volume',vehicle});
  r.context.showInfo=async()=>{};
  vm.runInContext(extract('handleCalculationCallback',true),r.context);
  await r.context.handleCalculationCallback({}, {from:{id:7},message:message(),data:'calc:back:document'});
  assert.equal(r.state(),null);
  assert.equal(await r.context.handleDocumentVolumeReply({},message('1997')),false);
});

test('unknown power stops before volume recovery rather than accepting a partial calculation',()=>{
  assert.throws(()=>calculateUtil({...vehicle, powerError:'Не удалось определить мощность',powerErrorCode:'POWER_DATA_AMBIGUOUS'}),
    error=>error.code==='POWER_DATA_AMBIGUOUS' && !error.details?.vehicle);
});
