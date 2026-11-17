import { canCheckFts } from './fts-access.js';

const DAY = 86400000;
const escape = value => String(value ?? 'не указано').slice(0, 300).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = value => String(value || '').replace(/\s/g, '').toUpperCase();
const name = value => String(value || '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
const navigation = { inline_keyboard: [[{ text: '‹ Назад', callback_data: 'fts:close' }, { text: '🏠 Главное меню', callback_data: 'menu' }]] };

export function ftsSearch(vehicle) {
  if (!['sbkts', 'epts'].includes(vehicle?.type)) return null;
  const vin = clean(vehicle.vin);
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return { vin };
  for (const field of ['body', 'chassis']) {
    const value = clean(vehicle[field]);
    if (/^[A-Z0-9-]{5,40}$/.test(value)) return { [field]: value };
  }
  return null;
}

export async function offerFtsCheck(env, message, vehicle, send) {
  const userId = message.from?.id;
  if (message.chat?.type !== 'private' || String(message.chat.id) !== String(userId) ||
      !env.APPLICATIONS || !await canCheckFts(env, userId)) return;
  if (!env.AVC_TOKEN) return; // No paid action until the runtime secret is configured.
  const search = ftsSearch(vehicle);
  if (!search) {
    await send(env, 'sendMessage', { chat_id: userId, text: 'Проверка ФТС: в документе не распознан корректный VIN. Проверьте номер в исходном документе.', reply_markup: navigation });
    return;
  }
  const stub = env.APPLICATIONS.getByName(String(userId));
  const id = await stub.saveFtsContext({ search, document: {
    vin: vehicle.vin || null, body: vehicle.body || null, chassis: vehicle.chassis || null,
    model: [vehicle.brand, vehicle.model].filter(Boolean).join(' ')
  }, createdAt: Date.now() });
  await send(env, 'sendMessage', { chat_id: userId,
    text: '🔎 Сверка с ФТС\n\nСверим идентификатор и наименование с документом, покажем дату выпуска и сведения об утильсборе. Запрос платный по тарифу AvtoVinCod, в том числе если сведений нет. Повторный результат из сохранённой проверки — без нового запроса.',
    reply_markup: { inline_keyboard: [[{ text: '🔎 Проверить ФТС', callback_data: `fts:check:${id}` }], ...navigation.inline_keyboard] } });
}

export async function handleFtsCallback(env, query, send) {
  if (!query.data?.startsWith('fts:')) return false;
  const message = query.message;
  const userId = query.from?.id;
  if (message?.chat?.type !== 'private' || String(message.chat.id) !== String(userId)) return true;
  if (query.data === 'fts:close') {
    await send(env, 'deleteMessage', { chat_id: userId, message_id: message.message_id });
    return true;
  }
  if (!await canCheckFts(env, userId)) {
    await send(env, 'sendMessage', { chat_id: userId, text: 'Доступ к проверке ФТС не выдан или отозван.', reply_markup: navigation });
    return true;
  }
  const id = query.data.match(/^fts:check:([a-f0-9-]{36})$/)?.[1];
  const context = id && env.APPLICATIONS ? await env.APPLICATIONS.getByName(String(userId)).getFtsContext(id) : null;
  if (!context || !env.AVC_TOKEN) {
    await send(env, 'sendMessage', { chat_id: userId, text: !env.AVC_TOKEN ? 'Проверка ФТС ещё не настроена.' : 'Кнопка устарела. Загрузите документ заново.', reply_markup: navigation });
    return true;
  }
  // One object per identifier serializes paid requests across all users/documents.
  const [field, value] = Object.entries(context.search)[0];
  const job = env.APPLICATIONS.getByName(`fts:${field}:${value}`);
  await job.subscribeFts({ search: context.search, userId: String(userId), callbackId: query.id, document: context.document });
  await send(env, 'sendMessage', { chat_id: userId,
    text: '🔎 Проверка ФТС запущена. Обычно ответ готовится около минуты. Результат придёт отдельным сообщением. Если проверка уже выполнена за последние 24 часа, вернём сохранённый ответ без нового списания.', reply_markup: navigation });
  return true;
}

export function ftsResultMessages(result, document) {
  const checked = result.checkedAt ? `\nПроверено: ${escape(result.checkedAt)}` : '';
  if (result.code) {
    const errors = {
      INSUFFICIENT_BALANCE: 'Недостаточно средств на балансе AvtoVinCod. Обратитесь к администратору.',
      PROCESSING: 'ФТС ещё готовит ответ. Проверка оплачена; автоматическое ожидание завершено. Не запускайте новую проверку, обратитесь к администратору.',
      UNCERTAIN: 'Ответ не получен. Запрос мог быть оплачен. Автоматический повтор отключён, чтобы избежать повторного списания. Обратитесь к администратору.',
      SOURCE_ERROR: 'Источник принял проверку, но не выполнил её. Проверка оплачена. Обратитесь к администратору.',
      ACCESS_REVOKED: 'Доступ к проверке ФТС отозван. Запрос не выполнялся.'
    };
    return [`🔎 <b>Проверка ФТС</b>\n\n${errors[result.code] || 'Сервис ФТС временно недоступен или доступ API не настроен. Обратитесь к администратору.'}\nКод: ${escape(result.code)}`];
  }
  if (!result.found) return [`🔎 <b>Проверка ФТС</b>${checked}\n\nСведения не найдены. Это не подтверждает отсутствие таможенного оформления или оплаты утильсбора.`];
  return result.records.flatMap((record, index) => {
    const identifiers = ['vin', 'body', 'chassis'].filter(field => document[field] && record[field]);
    const mismatch = identifiers.some(field => clean(document[field]) !== clean(record[field]));
    const compared = identifiers.length > 0;
    const modelMatch = document.model && record.model && name(document.model) === name(record.model);
    const lines = [
      `🔎 <b>Проверка ФТС — запись ${index + 1}</b>${checked}`,
      `<tg-spoiler>VIN: ${escape(record.vin)}\nКузов: ${escape(record.body)}\nШасси: ${escape(record.chassis)}</tg-spoiler>`,
      mismatch ? '⚠️ Идентификатор отличается от документа. Проверьте автомобиль вручную.' : compared ? '✅ Идентификатор совпадает с документом.' : '⚠️ Недостаточно данных для сверки идентификатора.',
      `Наименование ФТС: <b>${escape(record.model)}</b>`,
      `В документе: ${escape(document.model)}`,
      modelMatch ? '✅ Написание наименования совпадает.' : '⚠️ Написание наименования отличается или не указано. Нужна ручная сверка.',
      `Таможенный выпуск: ${escape(record.releaseDate)} ${escape(record.releaseTime)}`,
      'Дата выпуска ФТС показана справочно; срок и пени по СБКТС не пересчитаны.'
    ];
    const messages = [lines.join('\n')];
    const fees = Array.isArray(record.recyclingFee) ? record.recyclingFee : [];
    if (!fees.length) messages[0] += '\nСведения об утильсборе не переданы.';
    for (const fee of fees) messages.push([
      `Утильсбор — запись ФТС ${index + 1}`,
      `Статус: ${escape(fee.paymentStatus)}`,
      `Таможенный орган: ${escape(fee.customsCode)}`,
      `Для личного пользования: ${fee.personalUse === true ? 'да' : fee.personalUse === false ? 'нет' : 'не указано'}`,
      `Дата документа: ${escape(fee.date)}`,
      'Сумма оплаченного утильсбора в ответе API не указана.'
    ].join('\n'));
    return messages;
  });
}

export async function requestFts(env, search, fetcher = fetch) {
  try {
    const response = await fetcher(`https://api.avtovincod.ru/customs-fts?${new URLSearchParams(search)}`, {
      headers: { Authorization: `Bearer ${env.AVC_TOKEN}` }, signal: AbortSignal.timeout(90000)
    });
    const data = await response.json();
    if (data.success === 0 && typeof data.code === 'string') return { code: data.code, retryAfterSec: data.retryAfterSec };
    if (!response.ok || data.success !== 1 || typeof data.found !== 'boolean' || !Array.isArray(data.records) ||
        (data.found && !data.records.length) || data.records.some(record => !record || typeof record !== 'object')) return { code: 'UNCERTAIN' };
    return { found: data.found, records: data.records, checkedAt: data.checkedAt || null, testMode: data.testMode === true };
  } catch { return { code: 'UNCERTAIN' }; }
}

// Durable alarms outlive the webhook's background time limit. Persist the claim
// before the HTTP call; a crash never silently issues a second paid request.
export async function subscribeFts(storage, env, input) {
  if (!await canCheckFts(env, input.userId)) return;
  await storage.transaction(async tx => {
    let job = await tx.get('fts-job');
    const now = Date.now();
    if (!job || (job.expiresAt && job.expiresAt < now)) job = { search: input.search, state: 'queued', subscribers: {}, createdAt: now };
    const key = `${input.userId}:${input.callbackId}`;
    if (Object.keys(job.subscribers).length >= 1000) throw new Error('FTS subscriber limit');
    if (!job.subscribers[key]) job.subscribers[key] = { userId: input.userId, document: input.document, delivered: false };
    await tx.put('fts-job', job);
    if (job.state !== 'running') await tx.setAlarm(job.nextAt || now + 1);
  });
}

export async function runFtsAlarm(storage, env, send, fetcher = fetch) {
  const job = await storage.transaction(async tx => {
    const current = await tx.get('fts-job');
    if (!current) return null;
    if (current.state === 'running') {
      // Recovery after an interrupted attempt: its billing outcome is unknown.
      current.state = 'done'; current.result = { code: 'UNCERTAIN' }; current.expiresAt = Date.now() + DAY;
    }
    if (current.state === 'queued' && current.result?.code === 'PROCESSING' && Date.now() - current.createdAt >= 25 * 60000) {
      current.state = 'done'; current.expiresAt = Date.now() + DAY;
    }
    if (current.state === 'queued') {
      current.state = 'running';
      await tx.setAlarm(Date.now() + 120000);
    }
    await tx.put('fts-job', current);
    return current;
  });
  if (!job) return;
  if (job.state === 'running') {
    const allowed = await Promise.all(Object.values(job.subscribers).map(s => canCheckFts(env, s.userId)));
    const result = allowed.some(Boolean) && env.AVC_TOKEN ? await requestFts(env, job.search, fetcher) : { code: 'ACCESS_REVOKED' };
    await storage.transaction(async tx => {
      const current = await tx.get('fts-job');
      current.result = result;
      if (result.code === 'PROCESSING' && Date.now() - current.createdAt < 23 * 60000) {
        current.state = 'queued';
        current.nextAt = Date.now() + Math.min(120, Math.max(60, Number(result.retryAfterSec) || 60)) * 1000;
        await tx.setAlarm(current.nextAt);
      } else {
        current.state = 'done'; current.nextAt = null;
        const uncertainOrPaid = !result.code || ['UNCERTAIN', 'SOURCE_ERROR', 'PROCESSING'].includes(result.code);
        current.expiresAt = Date.now() + (uncertainOrPaid ? DAY : 60000);
        await tx.deleteAlarm();
      }
      await tx.put('fts-job', current);
    });
  }
  const completed = await storage.get('fts-job');
  if (completed.state !== 'done') return;
  for (const [key, subscriber] of Object.entries(completed.subscribers)) {
    if (subscriber.delivered) continue;
    // Claim delivery before sending; neither webhook nor alarm replay re-bills.
    await storage.transaction(async tx => {
      const current = await tx.get('fts-job');
      current.subscribers[key].delivered = true;
      await tx.put('fts-job', current);
    });
    if (!await canCheckFts(env, subscriber.userId)) continue;
    for (const text of ftsResultMessages(completed.result, subscriber.document)) {
      await send(env, 'sendMessage', { chat_id: subscriber.userId, text: `${completed.result.testMode ? '🧪 Бесплатный тест API. Данные условные.\n\n' : ''}${text}`, parse_mode: 'HTML', reply_markup: navigation });
    }
  }
}
