import { createDocumentTask } from './document-task.js';

const ready = new WeakMap();
const sections = { website_fts:'Сайт · проверка ФТС', admin:'Админка', document:'Загрузка PDF', group_document:'PDF в группе', fts:'Проверка ФТС', update:'Действие в боте', system:'Служебная задача' };
const stages = new Set(['журнал ошибок','открытие карточки пользователя','открытие админки','запрос сайта к ФТС','сохранение статуса загрузки','получение файла из Telegram','скачивание PDF из Telegram','проверка доступа к подписи','чтение PDF и расчёт','запуск проверки','обновление кнопки ФТС','проверка ФТС','доставка результата','обработка обновления']);
const reasons = {
 WEBSITE_FTS_ERROR:'Сайт не получил результат проверки ФТС', DOCUMENT_TIMEOUT:'Превышено время ожидания', DOCUMENT_ERROR:'Не удалось обработать документ',
 FTS_START_FAILED:'Не удалось запустить проверку ФТС', FTS_BUTTON_FAILED:'Не удалось обновить кнопку ФТС',
 FTS_UNCERTAIN:'Сервис не подтвердил результат запроса ФТС', FTS_SOURCE_ERROR:'Источник ФТС вернул ошибку',
 FTS_BALANCE:'Недостаточно средств у сервиса проверки ФТС', FTS_ALARM_ERROR:'Сбой фоновой проверки или доставки ответа ФТС',
 FTS_PROCESSING:'Сервис ФТС не завершил проверку в отведённое время',
 OPERATION_STALLED:'Задача не завершилась вовремя — возможно, выполнение оборвалось', UNHANDLED_ERROR:'Необработанная ошибка'
};
async function schema(db) {
 if(!ready.has(db)) ready.set(db,(async()=>{
  await db.prepare(`CREATE TABLE IF NOT EXISTS bot_incidents (
   id TEXT PRIMARY KEY, section TEXT NOT NULL, user_id TEXT, code TEXT NOT NULL, stage TEXT NOT NULL,
   first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, occurrences INTEGER NOT NULL DEFAULT 1,
   notified INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS bot_operations (
   id TEXT PRIMARY KEY, section TEXT NOT NULL, user_id TEXT, stage TEXT NOT NULL,
   started_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL, state TEXT NOT NULL
  )`).run();
 })().catch(e=>{ready.delete(db);throw e}));
 return ready.get(db);
}
const bounded = fn => createDocumentTask(1200).run('мониторинг', fn);
function safe(info) {
 return {section:Object.hasOwn(sections,info.section)?info.section:'update',
  userId:/^[1-9]\d{0,15}$/.test(String(info.userId||''))?String(info.userId):null,
  code:Object.hasOwn(reasons,info.code)?info.code:'UNHANDLED_ERROR',
  stage:stages.has(info.stage)?info.stage:'обработка обновления'};
}
export function incidentText(row) {
 const time=new Date(row.last_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'});
 return `🚨 Сбой бота\n${sections[row.section] || sections.update}\nЭтап: ${row.stage}\n${reasons[row.code] || reasons.UNHANDLED_ERROR}\nКод: ${row.code}\nПользователь: ${row.user_id || 'не определён'}\nВремя: ${time} МСК\nПовторений: ${row.occurrences}`;
}
export async function reportBotIncident(env, info) {
 if(!env.ANALYTICS_DB) return;
 try {await bounded(async()=>{
  const db=env.ANALYTICS_DB;await schema(db);
  const x=safe(info),now=Date.now();
  // Coalesce the same user's repeated error for five minutes. Never store raw
  // exception messages, URLs, tokens, document contents or identifiers.
  const id=info.operationId?`stalled:${info.operationId}`:[x.section,x.userId||'',x.code,x.stage,Math.floor(now/300000)].join(':');
  await db.prepare(`INSERT INTO bot_incidents(id,section,user_id,code,stage,first_at,last_at) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET occurrences=occurrences+1,last_at=excluded.last_at`)
   .bind(id,x.section,x.userId,x.code,x.stage,now,now).run();
 });return true;} catch {console.error('bot_monitoring_write_failed');return false;}
}
export async function monitorBotOperation(env, info, operation) {
 let id=null;
 if(env.ANALYTICS_DB) try {await bounded(async()=>{
  const db=env.ANALYTICS_DB;await schema(db);const x=safe(info);id=crypto.randomUUID();
  await db.prepare('INSERT INTO bot_operations(id,section,user_id,stage,started_at,deadline_at,state) VALUES(?,?,?,?,?,?,?)')
   .bind(id,x.section,x.userId,x.stage,Date.now(),Date.now()+(info.maxMs||90000),'running').run();
 });}catch {id=null;console.error('bot_monitoring_start_failed');}
 try {return await operation();}
 catch(error){await reportBotIncident(env,{...info,code:info.code || (info.section==='fts'?'FTS_START_FAILED':'UNHANDLED_ERROR')});throw error;}
 finally {if(id)try{await bounded(()=>env.ANALYTICS_DB.prepare("UPDATE bot_operations SET state='finished' WHERE id=? AND state='running'").bind(id).run());}catch{console.error('bot_monitoring_finish_failed');}}
}
export async function listBotIncidents(env, limit=10) {
 if(!env.ANALYTICS_DB)return [];
 await schema(env.ANALYTICS_DB);
 return (await env.ANALYTICS_DB.prepare('SELECT * FROM bot_incidents ORDER BY last_at DESC LIMIT ?').bind(limit).all()).results||[];
}
export async function pollBotMonitoring(env, send) {
 const db=env.ANALYTICS_DB;if(!db)return;
 await schema(db);
 const stale=(await db.prepare("SELECT * FROM bot_operations WHERE state='running' AND deadline_at<? LIMIT 20").bind(Date.now()).all()).results||[];
 for(const row of stale){
  await reportBotIncident(env,{section:row.section,userId:row.user_id,stage:row.stage,code:'OPERATION_STALLED',operationId:row.id});
  // Keep pending if persistence failed; the next cron will retry.
  const saved=await db.prepare('SELECT id FROM bot_incidents WHERE id=?').bind(`stalled:${row.id}`).first();
  if(saved)await db.prepare("UPDATE bot_operations SET state='stalled' WHERE id=? AND state='running'").bind(row.id).run();
 }
 const adminId=String(env.ADMIN_ID||env.ADMIN_TELEGRAM_ID||'');
 if(adminId){
  const pending=(await db.prepare('SELECT * FROM bot_incidents WHERE notified=0 AND lease_until<? ORDER BY first_at LIMIT 5').bind(Date.now()).all()).results||[];
  for(const row of pending){
   const now=Date.now(),lease=now+60000;
   const claim=await db.prepare('UPDATE bot_incidents SET lease_until=? WHERE id=? AND notified=0 AND lease_until<?').bind(lease,row.id,now).run();
   if(!claim.meta?.changes)continue;
   try{
    await createDocumentTask(5000).run('доставка результата',signal=>send(env,'sendMessage',{
     chat_id:adminId,text:incidentText(row),
     reply_markup:{inline_keyboard:[[{text:'🚨 Журнал ошибок',callback_data:'analytics:errors'}],...(row.user_id?[[{text:'👤 Пользователь',callback_data:`analytics:user:${row.user_id}`}]]:[])]}
    },{signal}));
    await db.prepare('UPDATE bot_incidents SET notified=1 WHERE id=? AND lease_until=?').bind(row.id,lease).run();
   }catch{await db.prepare('UPDATE bot_incidents SET lease_until=0 WHERE id=? AND lease_until=?').bind(row.id,lease).run();}
  }
 }
 const cutoff=Date.now()-30*86400000;
 await db.prepare('DELETE FROM bot_incidents WHERE last_at<?').bind(cutoff).run();
 await db.prepare("DELETE FROM bot_operations WHERE started_at<? AND state!='running'").bind(cutoff).run();
}
