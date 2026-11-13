import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { canCheckSignature, setSignatureAccess, filterSignatureState } from '../src/signature-access.js';

function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  const db={prepare(sql){const s=sqlite.prepare(sql);const bound=v=>({bind:(...v)=>bound(v),async first(){return s.get(...v)||null},async run(){return s.run(...v)}});return bound([])}};
  return {ADMIN_ID:'100',ANALYTICS_DB:db};
}
test('access defaults to administrator only, persists per user and revokes idempotently',async t=>{
 const env=fixture(t);
 assert.equal(await canCheckSignature(env,100),true);
 assert.equal(await canCheckSignature(env,200),false);
 await setSignatureAccess(env,100,200,true);
 await setSignatureAccess(env,100,200,true);
 assert.equal(await canCheckSignature({...env},'200'),true);
 assert.equal(await canCheckSignature(env,201),false);
 await setSignatureAccess(env,100,200,false);
 await setSignatureAccess(env,100,200,false);
 assert.equal(await canCheckSignature(env,200),false);
 await setSignatureAccess(env,100,100,false);
 assert.equal(await canCheckSignature(env,100),false);
});
test('ordinary users cannot grant access; missing or failed storage never opens it',async t=>{
 const env=fixture(t);
 await assert.rejects(setSignatureAccess(env,200,200,true),/Нет доступа/);
 await assert.rejects(setSignatureAccess(env,100,'-200',true),/Некорректные/);
 await assert.rejects(setSignatureAccess(env,100,200,'on'),/Некорректные/);
 assert.equal(await canCheckSignature({ADMIN_ID:'100'},200),false);
 assert.equal(await canCheckSignature(env,undefined),false);
 assert.equal(await canCheckSignature({...env,ANALYTICS_DB:{prepare(){throw Error('unavailable')}}},200),false);
});
test('revocation hides previous signature data in resumed flows without losing calculation data',async t=>{
 const env=fixture(t);
 const state={vehicle:{ccm:1997,signatureCheck:{presence:'present'}},utilYearContext:{vehicle:{totalKw:184,signatureCheck:{presence:'present'}},deadline:'2026-11-10'}};
 await setSignatureAccess(env,100,200,true);
 assert.ok((await filterSignatureState(env,200,structuredClone(state))).vehicle.signatureCheck);
 await setSignatureAccess(env,100,200,false);
 const result=await filterSignatureState(env,200,structuredClone(state));
 assert.equal(result.vehicle.signatureCheck,undefined);
 assert.equal(result.utilYearContext.vehicle.signatureCheck,undefined);
 assert.equal(result.vehicle.ccm,1997);assert.equal(result.utilYearContext.vehicle.totalKw,184);
});
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
function extract(name){const start=source.indexOf(`async function ${name}(`);assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2)}
test('admin card button grants and revokes access; forged and group callbacks do nothing',async t=>{
 const env=fixture(t),calls=[];
 const context=vm.createContext({canCheckSignature,setSignatureAccess,escapeHtml:String,
  getAnalyticsUser:async(_db,id)=>({user_id:id,first_name:'Test'}),
  telegram:async(_env,method,data)=>{calls.push({method,data});},clearAdminSession:async()=>{}});
 vm.runInContext(extract('showAnalyticsUser')+'\n'+extract('handleAnalyticsCallback'),context);
 const message={chat:{id:100,type:'private'},message_id:1};
 await context.showAnalyticsUser(env,message,'200');
 let button=calls.at(-1).data.reply_markup.inline_keyboard.flat().find(b=>b.callback_data.startsWith('analytics:signature:'));
 assert.equal(button.callback_data,'analytics:signature:200:on');
 const q={from:{id:100},message,data:button.callback_data};
 await context.handleAnalyticsCallback(env,{...q,from:{id:200}});
 await context.handleAnalyticsCallback(env,{...q,message:{...message,chat:{id:100,type:'group'}}});
 assert.equal(await canCheckSignature(env,200),false);
 await context.handleAnalyticsCallback(env,q);
 assert.equal(await canCheckSignature(env,200),true);
 button=calls.at(-1).data.reply_markup.inline_keyboard.flat()[0];
 assert.equal(button.callback_data,'analytics:signature:200:off');
 await context.handleAnalyticsCallback(env,{...q,data:button.callback_data});
 assert.equal(await canCheckSignature(env,200),false);
});
test('upload uses actual sender permission; group calculation never enables signature screening',async t=>{
 const env=fixture(t),checks=[],completed=[];
 const context=vm.createContext({Date,Uint8Array,canCheckSignature,
  getCustomsState:async()=>null,cleanupTemporaryMessages:async()=>{},trackTemporaryMessage:async()=>{},
  telegram:async(_env,method)=>method==='getFile'?{file_path:'test.pdf'}:{message_id:1},
  fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)}),
  processVehicleDocument:async(_bytes,_now,options)=>{checks.push(options?.checkSignature===true);return {vehicle:{},util:[],deadline:null}},
  finishDocumentCalculation:async(...args)=>completed.push(args),
  isGroupChat:chat=>chat?.type==='group',isPdfDocument:()=>true,
  formatDocumentResult:()=>'',sendDocumentIdentity:async()=>{}});
 vm.runInContext(extract('handleDocument')+'\n'+extract('handleGroupCalculation'),context);
 const message={document:{mime_type:'application/pdf',file_id:'test'},from:{id:200},chat:{id:200,type:'private'}};
 await context.handleDocument(env,message);
 await setSignatureAccess(env,100,200,true);
 await context.handleDocument(env,message);
 await context.handleGroupCalculation({...env,ANALYTICS_DB:null},{from:{id:200},message:{chat:{id:-10,type:'group'},reply_to_message:message}});
 await setSignatureAccess(env,100,200,false);
 await context.handleDocument(env,message);
 assert.deepEqual(checks,[false,true,false,false]);assert.equal(completed.length,3);
});
test('document pipeline skips inspection on success and failure unless explicitly enabled',async()=>{
 const source=readFileSync(new URL('../src/document-processing.js',import.meta.url),'utf8');
 const start=source.indexOf('export async function processVehicleDocument(');
 const body=source.slice(start,source.indexOf('\n}',start)+2).replace('export ','');
 let inspections=0,fail=false;
 const context=vm.createContext({Date,readPdf:async()=>{if(fail)throw Error('bad PDF');return {text:'x'.repeat(50)}},
  inspectPdfScreening:async()=>{inspections++;return {presence:'present'}},
  parseVehicleDocument:()=>({ccm:1997}),calculateUtil:()=>[{commercial:123}],addWorkingDays:()=>null});
 vm.runInContext(body,context);
 const no=await context.processVehicleDocument(new Uint8Array());
 assert.equal(no.vehicle.signatureCheck,undefined);assert.equal(inspections,0);
 const yes=await context.processVehicleDocument(new Uint8Array(),new Date(),{checkSignature:true});
 assert.equal(yes.vehicle.signatureCheck.presence,'present');assert.equal(inspections,1);
 fail=true;
 await assert.rejects(context.processVehicleDocument(new Uint8Array()),e=>!e.details?.signatureCheck);
 assert.equal(inspections,1);
 await assert.rejects(context.processVehicleDocument(new Uint8Array(),new Date(),{checkSignature:true}),e=>e.details.signatureCheck.presence==='present');
 assert.equal(inspections,2);
});
