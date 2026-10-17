import { ensureMessagingSchema, recordIncomingMessage, recordOutgoingMessage } from './crm-messaging.js';

const initialized = new WeakMap();
const adminId = env => String(env.ADMIN_ID || env.ADMIN_TELEGRAM_ID || '');
const contactUrl = env => env.CONTACT_URL || 'https://t.me/grani_broker';

async function ensureSupportSchema(db) {
  if (!initialized.has(db)) {
    const ready = (async () => {
      await ensureMessagingSchema(db);
      await db.prepare(`CREATE TABLE IF NOT EXISTS support_sessions (
        user_id TEXT PRIMARY KEY, context_text TEXT NOT NULL, expires_at INTEGER NOT NULL
      )`).run();
    })().catch(error => { initialized.delete(db); throw error; });
    initialized.set(db, ready);
  }
  return initialized.get(db);
}

export function supportErrorKeyboard(keyboard = {inline_keyboard:[]}) {
  return {inline_keyboard:[
    [{text:'☎️ Техническая поддержка',callback_data:'support:start'}],
    ...(keyboard.inline_keyboard || [])
  ]};
}

function supportKeyboard(back = true) {
  return {inline_keyboard:[
    [{text:'✅ Завершить обращение',callback_data:'support:done'}],
    [...(back ? [{text:'⬅️ Назад',callback_data:'support:back'}] : []),{text:'🏠 Главное меню',callback_data:'menu'}]
  ]};
}

export async function clearSupportSession(env, userId) {
  if (!env.ANALYTICS_DB) return;
  await ensureSupportSchema(env.ANALYTICS_DB);
  await env.ANALYTICS_DB.prepare('DELETE FROM support_sessions WHERE user_id=?').bind(String(userId)).run();
}

export async function openSupport(env, message, send) {
  if (message.chat?.type !== 'private') return;
  if (!env.ANALYTICS_DB || !adminId(env)) {
    return send(env,'sendMessage',{chat_id:message.chat.id,
      text:'Напишите в поддержку и приложите скриншот ошибки.',
      reply_markup:{inline_keyboard:[[{text:'☎️ Написать в поддержку',url:contactUrl(env)}],
        [{text:'⬅️ Назад',callback_data:'menu'},{text:'🏠 Главное меню',callback_data:'menu'}]]}});
  }
  const db=env.ANALYTICS_DB;
  await ensureSupportSchema(db);
  const source=String(message.text || message.caption || '');
  const context=/не удалось|не наш[её]л|слишком много|не найд|ошибк/i.test(source) ? source.slice(0,1200) : '';
  await db.prepare(`INSERT INTO support_sessions(user_id,context_text,expires_at) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET context_text=excluded.context_text,expires_at=excluded.expires_at`)
    .bind(String(message.chat.id),context,Date.now()+30*60*1000).run();
  return send(env,'sendMessage',{chat_id:message.chat.id,
    text:'☎️ Техническая поддержка\n\nОпишите проблему и приложите скриншот ошибки. Можно отправить несколько сообщений. Когда закончите, нажмите «Завершить обращение». Ответ придёт сюда, в бот.',
    reply_markup:supportKeyboard()});
}

async function deliverRequest(env, incoming, send) {
  const db=env.ANALYTICS_DB;
  const name=`support:${incoming.id}`,token=crypto.randomUUID(),now=Date.now();
  const claim=await db.prepare(`INSERT INTO analytics_delivery_locks(name,token,expires_at) VALUES(?,?,?)
    ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
    WHERE analytics_delivery_locks.expires_at < ?`).bind(name,token,now+60000,now).run();
  if (!claim.meta?.changes) return;
  try {
    const current=await db.prepare('SELECT admin_notification_id FROM crm_messages WHERE id=?').bind(incoming.id).first();
    if(current?.admin_notification_id)return;
    const user=await db.prepare('SELECT first_name,username FROM analytics_users WHERE user_id=?').bind(incoming.user_id).first();
    const label=[user?.first_name,user?.username ? '@'+user.username : '',incoming.user_id].filter(Boolean).join(' · ');
    const sent=await send(env,'sendMessage',{chat_id:adminId(env),
      text:`☎️ Обращение №${incoming.id}\nПользователь: ${label}\n\n${incoming.message_text.slice(0,3000)}`,
      reply_markup:{inline_keyboard:[
        [{text:'↩️ Ответить',callback_data:`analytics:reply:${incoming.user_id}:${incoming.id}`}],
        [{text:'💬 Переписка',callback_data:`analytics:conversation:${incoming.user_id}:0`}]
      ]}});
    // Copy the original even when it has a caption: photos/files must reach the admin.
    await send(env,'copyMessage',{chat_id:adminId(env),from_chat_id:incoming.user_id,message_id:incoming.telegram_message_id});
    await db.prepare('UPDATE crm_messages SET admin_notification_id=? WHERE id=?').bind(sent.message_id,incoming.id).run();
  } finally {
    await db.prepare('DELETE FROM analytics_delivery_locks WHERE name=? AND token=?').bind(name,token).run();
  }
}

export async function handleSupportMessage(env, message, send) {
  if (!env.ANALYTICS_DB || !adminId(env) || message.chat?.type!=='private') return false;
  const db=env.ANALYTICS_DB,userId=String(message.from?.id || message.chat.id);
  await ensureSupportSchema(db);
  const session=await db.prepare('SELECT * FROM support_sessions WHERE user_id=?').bind(userId).first();
  if (!session) return false;
  if (session.expires_at<Date.now() || String(message.text || '').startsWith('/')) {
    await clearSupportSession(env,userId);return false;
  }
  try {
    const incoming=await recordIncomingMessage(db,message,null,session.context_text);
    // Do not lose a saved request if Telegram temporarily refuses delivery.
    try { await deliverRequest(env,incoming,send); }
    catch(error) { console.error('Support notification pending',incoming.id,error.message); }
    const acknowledged=await db.prepare("SELECT id FROM crm_messages WHERE user_id=? AND direction='out' AND reply_to_id=? LIMIT 1")
      .bind(userId,incoming.id).first();
    if(!acknowledged) {
      const text='Мы приняли ваш запрос. Разберёмся в проблеме и ответим здесь. Можно добавить скриншот или уточнение.';
      const sent=await send(env,'sendMessage',{chat_id:message.chat.id,text,reply_markup:supportKeyboard(false)});
      await recordOutgoingMessage(db,userId,text,sent,{replyToId:incoming.id});
    }
    await db.prepare('UPDATE support_sessions SET expires_at=? WHERE user_id=?').bind(Date.now()+30*60*1000,userId).run();
  } catch(error) {
    console.error('Support request handling failed',error.message);
    await send(env,'sendMessage',{chat_id:message.chat.id,
      text:'Не удалось принять сообщение. Попробуйте ещё раз или напишите напрямую в поддержку.',
      reply_markup:{inline_keyboard:[[{text:'☎️ Написать напрямую',url:contactUrl(env)}],...supportKeyboard().inline_keyboard]}});
  }
  return true;
}

export async function retrySupportNotifications(env, send) {
  if(!env.ANALYTICS_DB || !adminId(env))return;
  const db=env.ANALYTICS_DB;
  await ensureSupportSchema(db);
  const pending=await db.prepare(`SELECT * FROM crm_messages WHERE direction='in'
    AND reply_to_id IS NULL AND admin_notification_id IS NULL ORDER BY id LIMIT 10`).all();
  for(const incoming of pending.results || []) {
    try { await deliverRequest(env,incoming,send); }
    catch(error) { console.error('Support notification retry failed',incoming.id,error.message); }
  }
}
