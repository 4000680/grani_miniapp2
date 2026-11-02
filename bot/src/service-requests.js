// Service requests are separate from calculator state and analytics events.
const ready=new WeakMap();
const admin=env=>String(env.ADMIN_ID||env.ADMIN_TELEGRAM_ID||'');
export const SERVICES={
 epts:{title:'Выгрузить ЭПТС',price:4000,text:'Выгрузим полный электронный ПТС по VIN-номеру. Выписка будет содержать все данные.\n\nСтоимость — 4 000 ₽.\n\nОтправьте VIN-номер автомобиля.'},
 sbkts_full:{title:'Выгрузить СБКТС',price:4000,text:'Выгрузим СБКТС по VIN-номеру автомобиля.\n\nСтоимость — 4 000 ₽.\n\nОтправьте VIN-номер автомобиля.'},
 documents_set:{title:'Комплект ЭПТС + СБКТС',price:6000,text:'Выгрузим полный ЭПТС и СБКТС по VIN-номеру автомобиля.\n\nСтоимость комплекта — 6 000 ₽.\n\nОтправьте VIN-номер автомобиля.'},
 sbkts:{title:'Скрин СБКТС',price:1000,text:'Предоставим скрин СБКТС с необходимыми данными по автомобилю.\n\nСтоимость — 1 000 ₽.\n\nОтправьте VIN-номер автомобиля.'},
 owner:{title:'Внести собственника в ЭПТС',price:4000,text:'Внесение собственника возможно, только если автомобиль стоит на учёте в ГАИ РФ.\n\nНеобходимые документы:\n• СТС — обязательно скан;\n• ДКП;\n• паспорт и страница с регистрацией;\n• СНИЛС;\n• ЭПТС.\n\nСтоимость — 4 000 ₽.\n\nЗаявитель должен быть зарегистрирован в системе электронных паспортов: https://dp.elpts.ru/\n\nЗагрузите все документы файлами. Когда загрузка завершится, нажмите «Отправить» под этим сообщением — один раз для всего комплекта.'}
};
function keys(kind,submit=false){return {inline_keyboard:[...(submit?[[{text:'📨 Отправить',callback_data:'service:send'}]]:[]),[{text:'⬅️ Назад',callback_data:['epts','sbkts_full','documents_set'].includes(kind)?'info:epts':'menu:services'},{text:'🏠 Главное меню',callback_data:'menu'}]]};}
async function schema(db){
 if(!ready.has(db))ready.set(db,(async()=>{
  await db.prepare('CREATE TABLE IF NOT EXISTS service_requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,vin TEXT,profile TEXT NOT NULL,admin_message INTEGER,locked_until INTEGER NOT NULL DEFAULT 0)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS service_sessions(user_id TEXT PRIMARY KEY,request_id TEXT NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS service_files(request_id TEXT NOT NULL,message_id INTEGER NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(request_id,message_id))').run();
 })().catch(e=>{ready.delete(db);throw e}));return ready.get(db);
}
export async function clearServiceSession(env,id){if(!env.ANALYTICS_DB)return;await schema(env.ANALYTICS_DB);await env.ANALYTICS_DB.prepare('DELETE FROM service_sessions WHERE user_id=?').bind(String(id)).run();}
async function current(env,id){await schema(env.ANALYTICS_DB);return env.ANALYTICS_DB.prepare('SELECT r.* FROM service_requests r JOIN service_sessions s ON s.request_id=r.id WHERE s.user_id=?').bind(String(id)).first();}
export async function openService(env,message,kind,send,selected=false){
 const item=SERVICES[kind];if(!item||message.chat?.type==='group'||message.chat?.type==='supergroup')return;
 if(!env.ANALYTICS_DB||!admin(env))return send(env,'sendMessage',{chat_id:message.chat.id,text:'Приём заявок временно недоступен. Напишите менеджеру.',reply_markup:{inline_keyboard:[[{text:'Написать менеджеру',url:env.CONTACT_URL||'https://t.me/grani_broker'}],...keys(kind).inline_keyboard]}});
 if(kind==='epts'&&!selected){
  await clearServiceSession(env,message.chat.id);
  return send(env,'sendMessage',{chat_id:message.chat.id,
   text:'📄 Выгрузить ЭПТС / СБКТС\n\nВыгрузим полный ЭПТС, СБКТС или оба документа по VIN-номеру автомобиля.\n\nЭПТС — 4 000 ₽\nСБКТС — 4 000 ₽\nКомплект ЭПТС + СБКТС — 6 000 ₽\n\nВыберите нужный вариант:',
   reply_markup:{inline_keyboard:[
    [{text:'📄 ЭПТС · 4 000 ₽',callback_data:'service:choose:epts'},{text:'📋 СБКТС · 4 000 ₽',callback_data:'service:choose:sbkts_full'}],
    [{text:'📑 Комплект · 6 000 ₽',callback_data:'service:choose:documents_set'}],
    [{text:'⬅️ Назад',callback_data:'menu:services'},{text:'🏠 Главное меню',callback_data:'menu'}]
   ]}});
 }
 const db=env.ANALYTICS_DB;await schema(db);const id=crypto.randomUUID(),user=String(message.chat.id);
 await db.prepare('INSERT INTO service_requests(id,user_id,kind,status,profile) VALUES(?,?,?,?,?)').bind(id,user,kind,'draft',JSON.stringify(message.from||{})).run();
 await db.prepare('INSERT INTO service_sessions(user_id,request_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET request_id=excluded.request_id').bind(user,id).run();
 return send(env,'sendMessage',{chat_id:message.chat.id,text:item.title+'\n\n'+item.text,reply_markup:keys(kind,kind==='owner')});
}
async function submit(env,r,send){
 const db=env.ANALYTICS_DB;
 if(r.status==='sent')return send(env,'sendMessage',{chat_id:r.user_id,text:'Эта заявка уже отправлена. Менеджер свяжется с вами.',reply_markup:keys(r.kind)});
 const files=(await db.prepare('SELECT * FROM service_files WHERE request_id=? ORDER BY message_id').bind(r.id).all()).results||[];
 if(r.kind==='owner'&&!files.length)return send(env,'sendMessage',{chat_id:r.user_id,text:'Сначала загрузите документы: скан СТС, ДКП, паспорт с регистрацией, СНИЛС и ЭПТС.',reply_markup:keys(r.kind,true)});
 const now=Date.now();const claim=await db.prepare("UPDATE service_requests SET locked_until=? WHERE id=? AND status!='sent' AND locked_until<?").bind(now+120000,r.id,now).run();if(!claim.meta?.changes)return;
 try{
  if(!r.admin_message){const p=JSON.parse(r.profile),label=[p.first_name,p.last_name,p.username?'@'+p.username:'',`ID ${r.user_id}`].filter(Boolean).join(' ');
   const sent=await send(env,'sendMessage',{chat_id:admin(env),text:`📨 Заявка: ${SERVICES[r.kind].title}\nНомер: ${r.id}\nКлиент: ${label}\nСтоимость: ${SERVICES[r.kind].price.toLocaleString('ru-RU')} ₽\n${r.vin?'VIN: '+r.vin:'Документов: '+files.length}`,reply_markup:{inline_keyboard:[[{text:'👤 Открыть клиента',url:`tg://user?id=${r.user_id}`}]]}});
   await db.prepare('UPDATE service_requests SET admin_message=? WHERE id=?').bind(sent.message_id,r.id).run();
  }
  for(const file of files){if(file.delivered)continue;await send(env,'copyMessage',{chat_id:admin(env),from_chat_id:r.user_id,message_id:file.message_id});await db.prepare('UPDATE service_files SET delivered=1 WHERE request_id=? AND message_id=?').bind(r.id,file.message_id).run();}
  await db.prepare("UPDATE service_requests SET status='sent' WHERE id=?").bind(r.id).run();
  await send(env,'sendMessage',{chat_id:r.user_id,text:'✅ Заявка принята. Менеджер свяжется с вами для согласования услуги и оплаты.',reply_markup:keys(r.kind)});
 }catch(e){console.error('Service delivery failed',r.id,e.message);await send(env,'sendMessage',{chat_id:r.user_id,text:'Не удалось отправить заявку полностью. Документы сохранены в заявке. Нажмите «Отправить», чтобы повторить.',reply_markup:keys(r.kind,true)});}
 finally{await db.prepare('UPDATE service_requests SET locked_until=0 WHERE id=?').bind(r.id).run();}
}
export async function handleServiceMessage(env,message,send){
 if(!env.ANALYTICS_DB||message.chat?.type!=='private')return false;
 const r=await current(env,message.chat.id);if(!r)return false;
 if(String(message.text||'').startsWith('/')){await clearServiceSession(env,message.chat.id);return false;}
 if(r.status==='sent'){await clearServiceSession(env,message.chat.id);return false;}
 await env.ANALYTICS_DB.prepare('UPDATE service_requests SET profile=? WHERE id=?').bind(JSON.stringify(message.from||{}),r.id).run();r.profile=JSON.stringify(message.from||{});
 if(r.kind!=='owner'){
  const vin=String(message.text||'').trim().toUpperCase();
  if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)){await send(env,'sendMessage',{chat_id:message.chat.id,text:'Отправьте VIN из 17 латинских букв и цифр, без I, O и Q.',reply_markup:keys(r.kind)});return true;}
  await env.ANALYTICS_DB.prepare('UPDATE service_requests SET vin=? WHERE id=?').bind(vin,r.id).run();r.vin=vin;await submit(env,r,send);return true;
 }
 if(!message.document&&!message.photo){await send(env,'sendMessage',{chat_id:message.chat.id,text:'Загрузите документы файлами или фотографиями. Когда комплект готов, нажмите «Отправить».',reply_markup:keys(r.kind,true)});return true;}
 const count=await env.ANALYTICS_DB.prepare('SELECT COUNT(*) AS n FROM service_files WHERE request_id=?').bind(r.id).first();
 if(count.n>=30){await send(env,'sendMessage',{chat_id:message.chat.id,text:'Можно приложить до 30 файлов. Отправьте готовый комплект.',reply_markup:keys(r.kind,true)});return true;}
 await env.ANALYTICS_DB.prepare('INSERT OR IGNORE INTO service_files(request_id,message_id) VALUES(?,?)').bind(r.id,message.message_id).run();
 return true;
}
export async function handleServiceCallback(env,query,send){
 const choice=query.data?.match(/^service:choose:(epts|sbkts_full|documents_set)$/);
 if(choice){await openService(env,{...query.message,from:query.from},choice[1],send,true);return true;}
if(query.data!=='service:send')return false;if(!env.ANALYTICS_DB)return true;const r=await current(env,query.from?.id||query.message.chat.id);if(r)await submit(env,r,send);else await send(env,'sendMessage',{chat_id:query.message.chat.id,text:'Откройте услугу заново: активной заявки нет.',reply_markup:keys('owner')});return true;}
