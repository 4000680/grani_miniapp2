import { extractContractApplicant, readPdf } from './document-processing.js';
import { hasContractAccess } from './contract-access.js';

const labels = {
  full_name: 'ФИО',
  address: 'Адрес регистрации',
  series: 'Серия паспорта',
  number: 'Номер паспорта',
  issued: 'Дата выдачи',
  issuer: 'Кем выдан'
};
const keys = Object.keys(labels);
const passportKeys = keys.slice(2);

export async function canFillContract(env, userId) {
  return Boolean(env.APPLICATIONS && env.CONTRACT_SERVICE_URL && env.CONTRACT_SERVICE_TOKEN
    && await hasContractAccess(env, userId));
}

function flowStore(env, userId) {
  return env.APPLICATIONS.getByName(`contract:${userId}`);
}

export async function closeContractDraft(env, userId, send) {
  if (!await canFillContract(env, userId)) return;
  const store = flowStore(env, userId);
  const draft = await store.getContractDraft();
  if (!draft) return;
  await store.clearContractDraft(draft.id);
  if (draft.preview) await send(env, 'deleteMessage', { chat_id: userId, message_id: draft.preview }).catch(() => {});
}

function isPrivateOwner(message, userId) {
  return message?.chat?.type === 'private' && String(message.chat.id) === String(userId);
}

function valid(key, value) {
  if (!value || value.length > 350) return false;
  if (key === 'series') return /^[0-9]{4}$/.test(value);
  if (key === 'number') return /^[0-9]{6}$/.test(value);
  if (key === 'full_name') return /^[\p{L}–-]+(?: +[\p{L}–-]+){1,2}$/u.test(value);
  if (key === 'issued') {
    const match = value.match(/^([0-9]{2})\.([0-9]{2})\.([0-9]{4})$/);
    if (!match) return false;
    const [, day, month, year] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === `${year}-${month}-${day}`;
  }
  return true;
}

async function service(env, path, body, contentType) {
  const url = new URL(path, env.CONTRACT_SERVICE_URL);
  if (url.protocol !== 'https:') throw new Error('Contract service requires HTTPS');
  return fetch(url, {
    method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(52000),
    headers: { authorization: `Bearer ${env.CONTRACT_SERVICE_TOKEN}`, 'content-type': contentType }
  });
}

function button(draft, text, action) {
  return { text, callback_data: `contract:${draft.id}:${action}` };
}

async function show(send, env, chatId, draft, text, rows, previous) {
  const markup = { inline_keyboard: [...rows, [button(draft, 'Отмена', 'cancel')]] };
  if (previous) await send(env, 'deleteMessage', { chat_id: chatId, message_id: previous }).catch(() => {});
  const sent = await send(env, 'sendMessage', { chat_id: chatId, text, reply_markup: markup, protect_content: true });
  return { ...draft, preview: sent.message_id };
}

async function review(send, env, chatId, draft, note = '') {
  const complete = keys.every(key => valid(key, draft.fields[key]));
  return show(send, env, chatId, { ...draft, stage: 'review', field: null }, [
    note, draft.template === 'tr24' ? 'Договор TR-24' : 'Договор ЛОГ', '',
    ...keys.map(key => `${labels[key]}: ${draft.fields[key] || 'не заполнено'}`)
  ].filter(Boolean).join('\n'), [
    ...(complete ? [[button(draft, 'Подтвердить и получить Word', 'confirm')]] : []),
    [button(draft, 'Изменить', 'edit'), button(draft, 'Загрузить фото паспорта', 'photo')]
  ], draft.preview);
}

export async function handleContractCallback(env, query, send) {
  if (!query.data?.startsWith('contract:')) return false;
  const userId = query.from?.id;
  if (!isPrivateOwner(query.message, userId) || !await canFillContract(env, userId)) return true;
  const store = flowStore(env, userId);
  if (query.data === 'contract:open') {
    const previous = await store.getContractDraft();
    const draft = await show(send, env, userId, {
      id: crypto.randomUUID().slice(0, 12), stage: 'sbkts', fields: {}
    }, 'Отправьте СБКТС в формате PDF для заполнения договора.', [], previous?.preview);
    await store.saveContractDraft(draft);
    return true;
  }
  const match = query.data.match(/^contract:([^:]+):(.+)$/);
  if (!match) return true;
  let draft = await store.getContractDraft();
  if (!draft || draft.id !== match[1]) {
    await send(env, 'sendMessage', { chat_id: userId, text: 'Откройте «Договор» в главном меню и загрузите СБКТС.' });
    return true;
  }
  const action = match[2];
  if (action === 'cancel') {
    await store.clearContractDraft(draft.id);
    if (draft.preview) await send(env, 'deleteMessage', { chat_id: userId, message_id: draft.preview }).catch(() => {});
    return true;
  }
  if (action === 'start' && draft.stage !== 'sbkts' && draft.stage !== 'reading-sbkts') {
    draft = await show(send, env, userId, { ...draft, stage: 'template' }, 'Выберите договор.', [
      [button(draft, 'TR-24', 'tr24'), button(draft, 'ЛОГ', 'log')]
    ], draft.preview);
  } else if ((draft.stage === 'template' && ['tr24', 'log'].includes(action)) || (draft.template && action === 'photo')) {
    const template = action === 'photo' ? draft.template : action;
    draft = await show(send, env, userId, { ...draft, template, stage: 'photo' },
      'Загрузите паспорт или введите данные вручную. Принимаю фото и PDF с разворотом на первой странице.', [
        [button(draft, 'Ввести вручную', 'manual')],
        [button(draft, 'Назад', action === 'photo' ? 'review' : 'start')]
      ], draft.preview);
  } else if (draft.template && action === 'review') {
    draft = await review(send, env, userId, draft);
  } else if (draft.template && (action === 'manual' || action === 'edit')) {
    draft = await show(send, env, userId, { ...draft, stage: 'edit' }, 'Какое поле заполнить или изменить?', [
      ...keys.map(key => [button(draft, labels[key], `field-${key}`)]),
      [button(draft, 'Назад', 'review')]
    ], draft.preview);
  } else if (draft.stage === 'edit' && action.startsWith('field-') && keys.includes(action.slice(6))) {
    const field = action.slice(6);
    const hint = field === 'issued' ? ' в формате ДД.ММ.ГГГГ' : '';
    draft = await show(send, env, userId, { ...draft, stage: 'field', field }, `Введите «${labels[field]}»${hint}.`, [
      [button(draft, 'Назад', 'edit')]
    ], draft.preview);
  } else if (draft.stage === 'review' && action === 'confirm' && keys.every(key => valid(key, draft.fields[key]))) {
    if (!await store.claimContractDraft(draft.id, 'review', 'sending')) return true;
    try {
      const response = await service(env, '/render', JSON.stringify({ template: draft.template, fields: draft.fields }), 'application/json');
      if (!response.ok) throw new Error('Contract render failed');
      const body = new FormData();
      body.set('chat_id', String(userId));
      body.set('protect_content', 'true');
      body.set('document', await response.blob(), draft.template === 'log' ? 'Договор ЛОГ.docx' : 'Договор TR-24.docx');
      await send(env, 'sendDocument', body);
    } catch {
      if (await store.claimContractDraft(draft.id, 'sending', 'review')) {
        await send(env, 'sendMessage', { chat_id: userId, text: 'Не удалось выдать договор. Нажмите «Подтвердить» ещё раз.' });
      }
      return true;
    }
    await store.clearContractDraft(draft.id);
    if (draft.preview) await send(env, 'deleteMessage', { chat_id: userId, message_id: draft.preview }).catch(() => {});
    return true;
  } else {
    return true;
  }
  await store.updateContractDraft(draft);
  return true;
}

export async function handleContractMessage(env, message, send) {
  const userId = message.from?.id;
  if (!isPrivateOwner(message, userId) || !await canFillContract(env, userId) || message.text?.startsWith('/')) return false;
  const store = flowStore(env, userId);
  let draft = await store.getContractDraft();
  if (!draft) return false;
  if (draft.stage === 'sbkts' && message.document) {
    const fileInfo = message.document;
    if (fileInfo.mime_type !== 'application/pdf' && !/\.pdf$/i.test(fileInfo.file_name || '')) {
      await send(env, 'sendMessage', { chat_id: userId, text: 'Отправьте СБКТС в формате PDF.' });
      return true;
    }
    if (!await store.claimContractDraft(draft.id, 'sbkts', 'reading-sbkts')) return true;
    let fields;
    try {
      const file = await send(env, 'getFile', { file_id: fileInfo.file_id }, { signal: AbortSignal.timeout(6000) });
      const response = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Telegram PDF unavailable');
      const document = await readPdf(new Uint8Array(await response.arrayBuffer()));
      if (!/СВИДЕТЕЛЬСТВО О БЕЗОПАСНОСТИ КОНСТРУКЦИИ/i.test(document.text.replace(/\s+/g, ' '))) {
        throw new Error('СБКТС не найден');
      }
      fields = extractContractApplicant(document);
    } catch {
      if (await store.claimContractDraft(draft.id, 'reading-sbkts', 'sbkts')) {
        await send(env, 'sendMessage', { chat_id: userId, text: 'Не удалось прочитать СБКТС. Отправьте другой PDF с текстовым слоем.' });
      }
      return true;
    }
    if (!await store.claimContractDraft(draft.id, 'reading-sbkts', 'template')) return true;
    draft = await show(send, env, userId, { ...draft, fields, stage: 'template' }, 'Выберите договор.', [
      [button(draft, 'TR-24', 'tr24'), button(draft, 'ЛОГ', 'log')]
    ], draft.preview);
    await store.updateContractDraft(draft);
    return true;
  }
  if (draft?.stage === 'field' && message.text) {
    let value = message.text.trim().replace(/\s+/g, ' ');
    if (draft.field === 'full_name') value = value.replace(/^Ф\.?И\.?О\.?\s*:\s*/i, '');
    if (draft.field === 'address') value = value.replace(/^адрес(?:\s+регистрации)?\s*:\s*/i, '');
    if (!valid(draft.field, value)) {
      await send(env, 'sendMessage', { chat_id: userId, text: `Проверьте формат поля «${labels[draft.field]}» и попробуйте ещё раз.` });
      return true;
    }
    draft.fields[draft.field] = value;
  } else if (draft.stage === 'photo' && (message.photo?.length || message.document)) {
    const source = message.document || message.photo.at(-1);
    const isPdf = source.mime_type === 'application/pdf' || /\.pdf$/i.test(source.file_name || '');
    if (message.document && !isPdf && !source.mime_type?.startsWith('image/') && !/\.(jpe?g|png|webp|tiff?)$/i.test(source.file_name || '')) {
      await send(env, 'sendMessage', { chat_id: userId, text: 'Пришлите фото или PDF-скан паспорта.' });
      return true;
    }
    if (source.file_size > 8 * 1024 * 1024) {
      await send(env, 'sendMessage', { chat_id: userId, text: 'Файл больше 8 МБ. Пришлите файл меньшего размера или введите данные вручную.' });
      return true;
    }
    if (!await store.claimContractDraft(draft.id, 'photo', 'reading')) return true;
    let failureMessage = 'Не удалось обработать файл паспорта. Попробуйте заново или введите данные вручную.';
    try {
      const file = await send(env, 'getFile', { file_id: source.file_id }, { signal: AbortSignal.timeout(6000) });
      const photo = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(10000) });
      if (!photo.ok) throw new Error('Telegram image unavailable');
      const bytes = await photo.arrayBuffer();
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Image too large');
      failureMessage = 'Сервис распознавания не смог обработать файл. Попробуйте фото или введите данные вручную.';
      const result = await service(env, '/ocr', bytes, isPdf ? 'application/pdf' : 'application/octet-stream');
      if (!result.ok) throw new Error('OCR unavailable');
      const fields = await result.json();
      if (!await store.claimContractDraft(draft.id, 'reading', 'photo')) return true;
      const recognized = passportKeys.filter(key => typeof fields[key] === 'string' && valid(key, fields[key]));
      for (const key of recognized) {
        if (!draft.fields[key]) draft.fields[key] = fields[key];
      }
      if (!recognized.length) {
        draft = await review(send, env, userId, draft, 'Файл обработан, но паспортные данные не прочитались. Пришлите более чёткий разворот или введите данные вручную.');
        await store.updateContractDraft(draft);
        return true;
      }
    } catch {
      if (!await store.claimContractDraft(draft.id, 'reading', 'photo')) return true;
      draft = await review(send, env, userId, draft, failureMessage);
      await store.updateContractDraft(draft);
      return true;
    }
  } else {
    const hint = {
      sbkts: 'Отправьте СБКТС в формате PDF.',
      photo: 'Пришлите фото или PDF-скан паспорта.',
      field: 'Отправьте значение поля текстом.',
      template: 'Выберите шаблон договора кнопкой.',
      method: 'Выберите загрузку паспорта или ручной ввод.',
      edit: 'Выберите поле кнопкой.',
      review: 'Проверьте данные и выберите действие кнопкой.'
    }[draft.stage];
    if (hint) await send(env, 'sendMessage', { chat_id: userId, text: hint });
    return true;
  }
  draft = await review(send, env, userId, draft);
  await store.updateContractDraft(draft);
  return true;
}
