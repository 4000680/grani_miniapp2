import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createDocumentTask} from '../src/document-task.js';

const never = () => new Promise(()=>{});
test('timeout aborts the network request and identifies the stage without leaking request details',async()=>{
 let signal;
 await assert.rejects(createDocumentTask(20).run('скачивание PDF', s=>{signal=s;return never()}),e=>e.code==='DOCUMENT_TIMEOUT' && e.documentStage==='скачивание PDF');
 assert.equal(signal.aborted,true);
});
test('one expired task cannot start more work, and completed stages preserve return values',async()=>{
 const task=createDocumentTask(20);
 assert.equal(await task.run('ready',()=>7),7);
 await assert.rejects(task.run('blocked',never),/Превышено/);
 let started=false;
 await assert.rejects(task.run('late',()=>{started=true}),/Превышено/);
 assert.equal(started,false);
});
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const start=source.indexOf('async function handleDocument(');
const handler=source.slice(start,source.indexOf('\n}',start)+2);
function runtime(stage) {
 const sent=[],done=[];
 const context=vm.createContext({Date,Uint8Array,console:{error(){}},
  createDocumentTask:()=>createDocumentTask(25),
  getCustomsState:async()=>null,cleanupTemporaryMessages:async()=>{},trackTemporaryMessage:async()=>{},
  telegram:async(_env,method,data)=>{
   if(method==='getFile')return stage==='getFile'?never():{file_path:'synthetic.pdf'};
   sent.push({method,data});return {message_id:12};
  },
  fetch:async(_url,{signal})=>stage==='headers'?never():{ok:true,arrayBuffer:async()=>stage==='body'?never():new ArrayBuffer(4)},
  canCheckSignature:async()=>false,
  processVehicleDocument:async()=>stage==='parse'?never():{vehicle:{},util:[],deadline:null},
  finishDocumentCalculation:async(...args)=>done.push(args),
  controlledDocumentError:e=>e,documentErrorText:e=>e.message,
  documentErrorKeyboard:()=>({inline_keyboard:[[{text:'Загрузить заново',callback_data:'calc:retry:document'}]]})
 });
 vm.runInContext(handler,context);
 return {context,sent,done};
}
for(const stage of ['getFile','headers','body','parse'])test(`stalled ${stage} replaces waiting message and never sends a late calculation`,async()=>{
 const r=runtime(stage);
 await r.context.handleDocument({BOT_TOKEN:'synthetic'}, {from:{id:2},chat:{id:2,type:'private'},document:{mime_type:'application/pdf',file_id:'synthetic'}});
 assert.equal(r.done.length,0);
 const error=r.sent.at(-1);
 assert.equal(error.method,'editMessageText');assert.equal(error.data.message_id,12);
 assert.match(error.data.text,/Превышено время ожидания/);assert.ok(error.data.reply_markup);
 assert.doesNotMatch(error.data.text,/synthetic|file\/bot/);
});
test('healthy PDF still produces the normal calculation',async()=>{
 const r=runtime(null);
 await r.context.handleDocument({}, {from:{id:2},chat:{id:2,type:'private'},document:{mime_type:'application/pdf'}});
 assert.equal(r.done.length,1);assert.equal(r.sent.filter(c=>c.data.text?.includes('Превышено')).length,0);
});
