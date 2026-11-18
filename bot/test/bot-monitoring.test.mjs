import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {reportBotIncident,monitorBotOperation,pollBotMonitoring,listBotIncidents,incidentText} from '../src/bot-monitoring.js';
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const db={prepare(sql){const s=sqlite.prepare(sql);const bound=v=>({bind:(...v)=>bound(v),async first(){return s.get(...v)||null},async all(){return {results:s.all(...v)}},async run(){const r=s.run(...v);return {meta:{changes:Number(r.changes)}}}});return bound([])}};
 return {env:{ANALYTICS_DB:db,ADMIN_ID:'100'},sqlite};
}
test('incidents coalesce repeated errors and alerts go only to configured administrator',async t=>{
 const {env}=fixture(t),calls=[];
 const info={section:'document',userId:200,code:'DOCUMENT_TIMEOUT',stage:'получение файла из Telegram'};
 await reportBotIncident(env,info);await reportBotIncident(env,info);
 await Promise.all([pollBotMonitoring(env,async(_env,method,data)=>calls.push({method,data})),pollBotMonitoring(env,async(_env,method,data)=>calls.push({method,data}))]);
 assert.equal(calls.length,1);assert.equal(calls[0].data.chat_id,'100');
 assert.match(calls[0].data.text,/Загрузка PDF/);assert.match(calls[0].data.text,/Повторений: 2/);
 await reportBotIncident(env,info);await pollBotMonitoring(env,async()=>assert.fail('same error must not send another alert'));
 assert.equal((await listBotIncidents(env))[0].occurrences,3);
});
test('failed Telegram alert stays queued and is retried without replaying the failed user action',async t=>{
 const {env}=fixture(t);await reportBotIncident(env,{section:'fts',userId:200,code:'FTS_START_FAILED',stage:'запуск проверки'});
 await pollBotMonitoring(env,async()=>{throw Error('network')});
 assert.equal((await listBotIncidents(env))[0].notified,0);
 const calls=[];await pollBotMonitoring(env,async(_env,_method,data)=>calls.push(data));
 assert.equal(calls.length,1);assert.match(calls[0].text,/Проверка ФТС/);
 assert.equal((await listBotIncidents(env))[0].notified,1);
});
test('hard-interrupted operation is detected after deadline; successful work does not alert',async t=>{
 const {env,sqlite}=fixture(t);
 assert.equal(await monitorBotOperation(env,{section:'document',userId:200},async()=>7),7);
 let resume;
 const pending=monitorBotOperation(env,{section:'document',userId:201},()=>new Promise(r=>{resume=r}));
 // Let asynchronous schema/insert finish before inspecting the running task.
 while(!resume)await new Promise(r=>setTimeout(r,1));
 sqlite.prepare("UPDATE bot_operations SET deadline_at=? WHERE state='running'").run(Date.now()-1);
 const sent=[];await pollBotMonitoring(env,async(_env,_method,data)=>sent.push(data));
 assert.equal(sent.length,1);assert.match(sent[0].text,/OPERATION_STALLED/);assert.match(sent[0].text,/201/);
 resume(8);assert.equal(await pending,8);
 await pollBotMonitoring(env,async()=>assert.fail('must not resend'));
});
test('exceptions are reported without raw messages, tokens, VIN, URLs or document data',async t=>{
 const {env,sqlite}=fixture(t);
 const secret='https://api.telegram.org/botSECRET/VIN123456789012345';
 await assert.rejects(monitorBotOperation(env,{section:'fts',userId:200,stage:secret},async()=>{throw Error(secret)}));
 const rows=await listBotIncidents(env);
 assert.equal(rows.length,1);assert.equal(rows[0].stage,'обработка обновления');
 assert.doesNotMatch(JSON.stringify(rows)+incidentText(rows[0]),/SECRET|VIN123|https:/);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bot_operations WHERE state='running'").get().n,0);
});
test('monitoring storage failure does not prevent a normal calculation',async()=>{
 const env={ANALYTICS_DB:{prepare(){throw Error('db down')}}};
 assert.equal(await monitorBotOperation(env,{section:'document'},async()=>123),123);
});
test('incident journal is restricted by the existing administrator callback guard',async t=>{
 const {env}=fixture(t),calls=[];
 const src=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 const i=src.indexOf('async function handleAnalyticsCallback(');
 const context=vm.createContext({listBotIncidents,incidentText,telegram:async(_e,_m,d)=>calls.push(d)});
 vm.runInContext(src.slice(i,src.indexOf('\n}',i)+2),context);
 const q={data:'analytics:errors',from:{id:200},message:{chat:{id:200,type:'private'},message_id:1}};
 await context.handleAnalyticsCallback(env,q);assert.equal(calls.length,0);
 await context.handleAnalyticsCallback(env,{...q,from:{id:100},message:{...q.message,chat:{id:100,type:'private'}}});
 assert.match(calls[0].text,/Ошибок пока нет/);
});

test('FTS button never downloads PDF, and a failed start is queued for administrator',async t=>{
 const {env}=fixture(t);env.AVC_TOKEN='synthetic';
 const {setFtsAccess}=await import('../src/fts-access.js');
 const {handleFtsCallback}=await import('../src/fts.js');
 await setFtsAccess(env,100,200,true);
 const context={search:{vin:'X7TEST00000000001'},document:{type:'sbkts',model:'Test'}};
 env.APPLICATIONS={getByName:()=>({getFtsContext:async()=>context,subscribeFts:async()=>{throw Error('interrupted')}})};
 const calls=[];
 await handleFtsCallback(env,{id:'callback',from:{id:200},data:'fts:check:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',message:{message_id:1,chat:{id:200,type:'private'}}},async(_env,method,data)=>{
  assert.notEqual(method,'getFile');calls.push({method,data});return {message_id:2};
 });
 assert.ok(calls.some(c=>c.data.text?.includes('Не удалось запустить проверку ФТС')));
 assert.equal((await listBotIncidents(env))[0].code,'FTS_START_FAILED');
});
test('reporting a failed FTS result and retrying its delivery never repeats the paid API call',async t=>{
 const {env}=fixture(t);env.AVC_TOKEN='synthetic';
 const {setFtsAccess}=await import('../src/fts-access.js');
 const {subscribeFts,runFtsAlarm}=await import('../src/fts.js');
 await setFtsAccess(env,100,200,true);
 const data=new Map();const store={async get(k){return structuredClone(data.get(k))},async put(k,v){data.set(k,structuredClone(v))},async setAlarm(){},async deleteAlarm(){},async transaction(fn){return fn(store)}};
 await subscribeFts(store,env,{search:{vin:'X7TEST00000000001'},userId:'200',callbackId:'test',document:{type:'sbkts',model:'Test'}});
 let requests=0;const fetcher=async()=>{requests++;return {ok:true,json:async()=>({success:0,code:'SOURCE_ERROR'})}};
 await assert.rejects(runFtsAlarm(store,env,async()=>{throw Error('Telegram unavailable')},fetcher));
 await runFtsAlarm(store,env,async()=>({message_id:1}),fetcher);
 assert.equal(requests,1);
 const rows=await listBotIncidents(env);assert.equal(rows.length,1);assert.equal(rows[0].code,'FTS_SOURCE_ERROR');
 assert.doesNotMatch(JSON.stringify(rows),/X7TEST/);
});
