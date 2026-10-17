import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import vm from 'node:vm';
import {trackUpdate} from '../src/analytics.js';
import {sendDirectMessage} from '../src/crm-messaging.js';
import {openSupport,handleSupportMessage,clearSupportSession,retrySupportNotifications,supportErrorKeyboard} from '../src/support-flow.js';

const hooks=registerHooks({resolve(specifier,context,next){
  return specifier==='cloudflare:workers' ? {url:'data:text/javascript,export class DurableObject {}',shortCircuit:true} : next(specifier,context);
}});
const {default:worker}=await import('../src/index.js');hooks.deregister();

function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  sqlite.exec(readFileSync(new URL('../../migrations/0001_analytics.sql',import.meta.url),'utf8'));
  const db={prepare(sql){const statement=sqlite.prepare(sql);const bind=values=>({bind:(...values)=>bind(values),
    async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};},
    async run(){const r=statement.run(...values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}});return bind([]);}};
  const env={ANALYTICS_DB:db,ADMIN_ID:'100',BOT_TOKEN:'fake-support-token',WEBHOOK_SECRET:'secret',MINI_APP_URL:'https://example.test'};
  let id=1000;
  const calls=[];
  const send=async(_env,method,data)=>{const result={message_id:++id};calls.push({method,data,result});return result;};
  const message=(extra={})=>({message_id:++id,from:{id:200},chat:{id:200,type:'private'},...extra});
  const enter=async()=>trackUpdate(db,{message:message({text:'/start'})});
  return {env,db,sqlite,calls,send,message,enter};
}

test('support stores text and captioned screenshots, acknowledges once and reuses admin replies',async t=>{
  const f=fixture(t);await f.enter();
  await openSupport(f.env,f.message({text:'Автомобиль не найден'}),f.send);
  const input=f.message({photo:[{file_id:'screenshot'}],caption:'Поиск не сработал'});
  assert.equal(await handleSupportMessage(f.env,input,f.send),true);
  assert.equal(await handleSupportMessage(f.env,input,f.send),true);
  const incoming=f.sqlite.prepare("SELECT * FROM crm_messages WHERE direction='in'").get();
  assert.match(incoming.message_text,/Автомобиль не найден/);
  assert.match(incoming.message_text,/Поиск не сработал/);
  assert.ok(incoming.admin_notification_id);
  assert.equal(f.calls.filter(c=>c.method==='copyMessage').length,1);
  assert.equal(f.calls.filter(c=>c.data.text?.startsWith('Мы приняли')).length,1);
  const notification=f.calls.find(c=>c.data.text?.includes(`Обращение №${incoming.id}`));
  assert.equal(notification.data.reply_markup.inline_keyboard[0][0].callback_data,`analytics:reply:200:${incoming.id}`);
  let reply;
  await sendDirectMessage(f.db,200,'Всё исправлено, попробуйте снова',async(chatId,text,parent)=>{
    reply={chatId,text,parent};return {message_id:5000};
  },incoming.id);
  assert.equal(reply.parent,input.message_id);
  assert.equal(reply.chatId,'200');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM crm_messages WHERE direction='in'").get().n,1);
});

test('multiple messages remain in support until exit; ordinary documents and groups are unaffected',async t=>{
  const f=fixture(t);await f.enter();
  assert.equal(await handleSupportMessage(f.env,f.message({text:'Toyota 2026'}),f.send),false);
  await openSupport(f.env,f.message(),f.send);
  assert.equal(await handleSupportMessage(f.env,f.message({text:'Описание'}),f.send),true);
  assert.equal(await handleSupportMessage(f.env,f.message({document:{file_name:'screen.png',file_id:'file'}}),f.send),true);
  assert.equal(f.calls.filter(c=>c.method==='copyMessage').length,2);
  assert.equal(await handleSupportMessage(f.env,f.message({chat:{id:-1,type:'group'},text:'group'}),f.send),false);
  await clearSupportSession(f.env,200);
  assert.equal(await handleSupportMessage(f.env,f.message({document:{file_name:'car.pdf'}}),f.send),false);
  await openSupport(f.env,f.message(),f.send);
  assert.equal(await handleSupportMessage(f.env,f.message({text:'/menu'}),f.send),false);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM support_sessions').get().n,0);
});

test('attachment delivery failure stays queued and the scheduled retry delivers it',async t=>{
  const f=fixture(t);await f.enter();await openSupport(f.env,f.message(),f.send);
  t.mock.method(console,'error',()=>{});
  const input=f.message({document:{file_id:'screen',file_name:'screen.png'}});
  await handleSupportMessage(f.env,input,async(env,method,data)=>{
    if(method==='copyMessage')throw new Error('temporary Telegram failure');
    return f.send(env,method,data);
  });
  assert.equal(f.sqlite.prepare("SELECT admin_notification_id FROM crm_messages WHERE direction='in'").get().admin_notification_id,null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM analytics_delivery_locks').get().n,0);
  f.sqlite.prepare('INSERT INTO analytics_delivery_locks VALUES(?,?,?)').run('support:1','expired',0);
  await retrySupportNotifications(f.env,f.send);
  await retrySupportNotifications(f.env,f.send);
  assert.ok(f.sqlite.prepare("SELECT admin_notification_id FROM crm_messages WHERE direction='in'").get().admin_notification_id);
  assert.equal(f.calls.filter(c=>c.method==='copyMessage').length,1);
  assert.equal(f.calls.filter(c=>c.data.text?.startsWith('Мы приняли')).length,1);
});

test('delivery lock prevents concurrent duplicate admin notifications',async t=>{
  const f=fixture(t);await f.enter();await openSupport(f.env,f.message(),f.send);
  t.mock.method(console,'error',()=>{});
  await handleSupportMessage(f.env,f.message({text:'problem'}),async(env,method,data)=>{
    if(String(data.chat_id)==='100')throw new Error('offline');return f.send(env,method,data);
  });
  await Promise.all([retrySupportNotifications(f.env,f.send),retrySupportNotifications(f.env,f.send)]);
  assert.equal(f.calls.filter(c=>c.method==='copyMessage').length,1);
});

test('missing delivery configuration offers direct contact without falsely accepting a request',async t=>{
  const f=fixture(t);
  await openSupport({...f.env,ADMIN_ID:''},f.message(),f.send);
  assert.equal(f.calls.length,1);
  assert.match(f.calls[0].data.reply_markup.inline_keyboard[0][0].url,/t\.me/);
  assert.doesNotMatch(f.calls[0].data.text,/приняли/);
  const keyboard=supportErrorKeyboard({inline_keyboard:[[{text:'Назад',callback_data:'back'}]]});
  assert.equal(keyboard.inline_keyboard[0][0].callback_data,'support:start');
  assert.equal(keyboard.inline_keyboard[1][0].callback_data,'back');
});

test('expired support mode cannot consume a subsequent vehicle or document calculation',async t=>{
  const f=fixture(t);await f.enter();await openSupport(f.env,f.message(),f.send);
  f.sqlite.prepare('UPDATE support_sessions SET expires_at=0').run();
  assert.equal(await handleSupportMessage(f.env,f.message({document:{file_name:'vehicle.pdf'}}),f.send),false);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM support_sessions').get().n,0);
});

test('failed search and PDF errors expose support alongside existing navigation',async()=>{
  const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  function extract(name){const start=source.search(new RegExp('(?:async )?function '+name+'\\('));return source.slice(start,source.indexOf('\n}',start)+2);}
  for(const failure of ['no-model','no-brand','network']) {
    const calls=[];
    const context=vm.createContext({supportErrorKeyboard,
      getCustomsState:async()=>null,cleanupTemporaryMessages:async()=>{},trackTemporaryMessage:async()=>{},
      telegram:async(_env,method,data)=>{calls.push({method,data});return {message_id:1};},
      loadCatalog:async()=>{if(failure==='network')throw new Error('unavailable');return {};},
      resolveCatalogBrand:()=>({status:failure==='no-brand'?'none':'exact'}),
      listCatalogModifications:()=>[],listCatalogNeighborYears:()=>[],listCatalogSuggestions:()=>[],
      catalogSearchKeyboard:()=>({inline_keyboard:[[{text:'Назад',callback_data:'catalog:back:search'}]]}),
      escapeHtml:x=>x
    });
    vm.runInContext(['calculationWorkKeyboard','documentErrorKeyboard','runCatalogTextSearch'].map(extract).join('\n'),context);
    await context.runCatalogTextSearch({}, {chat:{id:200},from:{id:200}}, {vehicleText:'TEST MISSING',year:2026});
    const error=calls.at(-1).data;
    assert.ok(error.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='support:start'),failure);
    assert.ok(error.reply_markup.inline_keyboard.flat().length>1);
    const document=context.documentErrorKeyboard().inline_keyboard.flat();
    for(const action of ['support:start','calc:retry:document','calc:back:document','calc:menu']) {
      assert.ok(document.some(b=>b.callback_data===action));
    }
  }
});

test('webhook routes support documents to admin, admin reply requires preview and confirmation, then calculator resumes',async t=>{
  const f=fixture(t);
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.match(String(url),/^https:\/\/api.telegram.org\/botfake-support-token\//);
    const result=await f.send(f.env,String(url).split('/').at(-1),JSON.parse(options.body));
    return Response.json({ok:true,result});
  });
  async function webhook(update){const tasks=[];const response=await worker.fetch(new Request('https://test/webhook',{
    method:'POST',headers:{'x-telegram-bot-api-secret-token':'secret'},body:JSON.stringify(update)
  }),f.env,{waitUntil:p=>tasks.push(p)});assert.equal(response.status,200);await Promise.all(tasks);}
  const callback=(data,id=200)=>({callback_query:{id:'q',from:{id},data,message:{message_id:10,chat:{id,type:'private'},text:'Ошибка поиска'}}});
  await webhook(callback('support:start'));
  await webhook({message:f.message({document:{file_id:'screen',file_name:'error.pdf',mime_type:'application/pdf'},caption:'Скриншот'})});
  assert.equal(f.calls.filter(c=>c.method==='getFile').length,0);
  const notification=f.calls.find(c=>c.data.text?.startsWith('☎️ Обращение'));
  const replyCallback=notification.data.reply_markup.inline_keyboard[0][0].callback_data;
  await webhook(callback(replyCallback,300));
  assert.equal(f.calls.filter(c=>c.data.text?.startsWith('Напишите сообщение для')).length,0);
  await webhook(callback(replyCallback,100));
  await webhook({message:{...f.message({text:'Всё исправлено, попробуйте снова'}),from:{id:100},chat:{id:100,type:'private'}}});
  const preview=f.calls.at(-1);
  assert.match(preview.data.text,/Предпросмотр/);
  assert.ok(!f.calls.some(c=>String(c.data.chat_id)==='200'&&c.data.text==='Всё исправлено, попробуйте снова'));
  await webhook(callback(preview.data.reply_markup.inline_keyboard[0][0].callback_data,100));
  assert.ok(f.calls.some(c=>String(c.data.chat_id)==='200'&&c.data.text==='Всё исправлено, попробуйте снова'));
  await webhook(callback('support:done'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM support_sessions WHERE user_id=?').get('200').n,0);
  await webhook(callback('menu:services'));
  assert.ok(f.calls.at(-1).data.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='info:epts'));
  assert.ok(!f.calls.some(c=>c.data.text?.startsWith('Не удалось выполнить действие')));
  await webhook(callback('support:start'));
  await webhook(callback('support:back'));
  assert.equal(f.calls.at(-1).method,'deleteMessage');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM support_sessions WHERE user_id=?').get('200').n,0);
});
