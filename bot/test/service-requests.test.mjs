import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {openService,handleServiceMessage,handleServiceCallback,clearServiceSession,SERVICES} from '../src/service-requests.js';
function fixture(t){const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const db={prepare(sql){const s=sqlite.prepare(sql);const bind=v=>({bind:(...v)=>bind(v),async first(){return s.get(...v)||null},async all(){return {results:s.all(...v)}},async run(){const r=s.run(...v);return {meta:{changes:Number(r.changes)}}}});return bind([])}};
 const env={ANALYTICS_DB:db,ADMIN_ID:'100'};const calls=[];let id=1000,failCopy=false;
 const send=async(_e,method,data)=>{if(failCopy&&method==='copyMessage'){failCopy=false;throw Error('temporary')}calls.push({method,data});return {message_id:++id}};
 const msg=x=>({message_id:++id,from:{id:200,username:'client',first_name:'Client'},chat:{id:200,type:'private'},...x});
 return {env,calls,send,msg,sqlite,fail(){failCopy=true}};
}
for(const kind of ['epts','sbkts','sbkts_full','documents_set'])test(kind+' validates VIN and notifies only configured administrator',async t=>{
 const f=fixture(t);await openService(f.env,f.msg(),kind,f.send,true);
 assert.equal(await handleServiceMessage(f.env,f.msg({text:'bad'}),f.send),true);
 assert.equal(f.calls.filter(x=>x.data.chat_id==='100').length,0);
 await handleServiceMessage(f.env,f.msg({text:'WBAJB9C50KB287123'}),f.send);
 const admin=f.calls.find(x=>x.data.chat_id==='100');assert.ok(admin);assert.match(admin.data.text,/WBAJB9C50KB287123/);assert.ok(admin.data.text.includes(SERVICES[kind].title));assert.match(admin.data.text,/@client/);
 assert.equal(admin.data.reply_markup.inline_keyboard[0][0].url,'tg://user?id=200');
 assert.ok(f.calls.some(x=>x.data.text?.includes('Заявка принята')));
 await handleServiceCallback(f.env,{data:'service:send',from:{id:200},message:f.msg()},f.send);
 assert.equal(f.calls.filter(x=>x.data.chat_id==='100').length,1);
});
test('owner documents wait for submission, retry delivery, retain original files and do not leak to another user',async t=>{
 const f=fixture(t);await openService(f.env,f.msg(),'owner',f.send);
 await handleServiceCallback(f.env,{data:'service:send',from:{id:200},message:f.msg()},f.send);
 assert.equal(f.calls.filter(x=>x.data.chat_id==='100').length,0);
 assert.equal(await handleServiceMessage(f.env,f.msg({from:{id:300},chat:{id:300,type:'private'},document:{file_id:'other'}}),f.send),false);
 for(let i=0;i<4;i++)await handleServiceMessage(f.env,f.msg({document:{file_id:'doc'+i}}),f.send);
 assert.equal(f.calls.filter(x=>x.method==='copyMessage').length,0);
 f.fail();const q={data:'service:send',from:{id:200},message:f.msg()};await handleServiceCallback(f.env,q,f.send);
 assert.ok(f.calls.some(x=>x.data.text?.includes('Не удалось отправить')));
 await handleServiceCallback(f.env,q,f.send);
 assert.equal(f.calls.filter(x=>x.data.chat_id==='100'&&x.method==='sendMessage').length,1);
 assert.equal(f.calls.filter(x=>x.method==='copyMessage').length,4);
 assert.ok(f.calls.some(x=>x.data.text?.includes('Заявка принята')));
 await clearServiceSession(f.env,200);
 assert.equal(await handleServiceMessage(f.env,f.msg({document:{file_id:'calculator'}}),f.send),false);
});
test('commands and groups do not enter the service upload flow',async t=>{
 const f=fixture(t);await openService(f.env,f.msg(),'owner',f.send);
 assert.equal(await handleServiceMessage(f.env,f.msg({chat:{id:200,type:'group'},text:'hello'}),f.send),false);
 assert.equal(await handleServiceMessage(f.env,f.msg({text:'/start'}),f.send),false);
 assert.equal(await handleServiceMessage(f.env,f.msg({document:{file_id:'calculation'}}),f.send),false);
});

test('five simultaneous owner uploads are silent and one original button submits the entire batch',async t=>{
 const f=fixture(t);await openService(f.env,f.msg(),'owner',f.send);
 const opening=f.calls[0];assert.match(opening.data.text,/СНИЛС/);assert.match(opening.data.text,/зарегистрирован/);
 assert.match(opening.data.text,/https:\/\/dp\.elpts\.ru\//);assert.doesNotMatch(opening.data.text,/СТС пришлите именно/);
 assert.equal(opening.data.reply_markup.inline_keyboard.flat().filter(x=>x.callback_data==='service:send').length,1);
 const files=Array.from({length:5},(_,i)=>f.msg({document:{file_id:'batch-'+i},media_group_id:'album'}));
 await Promise.all(files.map(m=>handleServiceMessage(f.env,m,f.send)));
 assert.equal(f.calls.length,1,'no replies, new buttons or admin notifications while uploading');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM service_files').get().n,5);
 await handleServiceCallback(f.env,{data:'service:send',from:{id:200},message:f.msg()},f.send);
 assert.equal(f.calls.filter(c=>c.method==='copyMessage').length,5);
 assert.equal(f.calls.filter(c=>c.data.text?.includes('Заявка принята')).length,1);
});

test('document chooser shows three prices and selected package reaches administrator',async t=>{
 const f=fixture(t);await openService(f.env,f.msg(),'epts',f.send);
 const picker=f.calls.at(-1).data;const buttons=picker.reply_markup.inline_keyboard.flat();
 assert.equal(buttons.filter(b=>b.callback_data.startsWith('service:choose:')).length,3);
 assert.match(picker.text,/Комплект ЭПТС \+ СБКТС — 6 000 ₽/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM service_sessions').get().n,0);
 await handleServiceCallback(f.env,{data:'service:choose:documents_set',from:{id:200,username:'client'},message:f.msg()},f.send);
 assert.match(f.calls.at(-1).data.text,/VIN/);
 await handleServiceMessage(f.env,f.msg({text:'WBAJB9C50KB287123'}),f.send);
 const notice=f.calls.find(c=>c.data.chat_id==='100');
 assert.match(notice.data.text,/Комплект ЭПТС \+ СБКТС/);assert.match(notice.data.text,/6.000 ₽/);
 assert.equal(SERVICES.sbkts.price,1000);
});
