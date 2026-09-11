import { calculationPower, getCatalogCandidate, loadCatalog, parseCatalogQuery, searchCatalog } from './catalog-search.js';
import {
  addWorkingDays,
  calculatePeni,
  calculateUtil,
  parseFlexibleDate,
  parseVehicleDocument,
  readPdf,
  todayUtc
} from './document-processing.js';
export { ApplicationsStore } from './applications-store.js';

const MENU_TEXT = [
  'Здравствуйте! Я — помощник компании «Брокер Грани» 👋',
  '',
  'Мы создали этот бот, чтобы автоматизировать ежедневные задачи брокера и упростить оформление автомобилей по параллельному импорту.',
  '',
  'Выберите нужный раздел ниже или отправьте сюда PDF-файл СБКТС или выписку ЭПТС 👇',
  '',
  'Для поиска по справочнику просто напишите марку, модель и год, например: <code>Kia Niro EV 2022</code>.',
  '',
  'Функционал бота постоянно пополняется.'
].join('\n');

const INFO = {
  pdf: {
    title: '📎 <b>Расчёт по документу</b>',
    text: [
      'Отправьте в этот чат PDF-файл СБКТС или выписку ЭПТС — можно просто переслать документ из другого чата.',
      '',
      'Я распознаю характеристики автомобиля и рассчитаю утильсбор. Для выписки ЭПТС после расчёта попрошу дату оформления СБКТС, чтобы определить пени.'
    ].join('\n')
  },
  payment: {
    title: '💳 <b>Реквизиты для оплаты утильсбора</b>',
    text: [
      'Оплатить пошлину можно в любом отделении банка или в мобильном приложении банка.',
      '',
      'Также для моментального зачисления платежа можно воспользоваться <a href="https://edata.customs.ru/FtsPersonalCabinetWeb/Mobile">личным кабинетом ФТС</a>. При оплате взимается комиссия.',
      '',
      'Выберите нужный вариант 👇'
    ].join('\n')
  },
  payment_details: {
    title: '💳 <b>Реквизиты</b>',
    text: 'Реквизиты будут добавлены чуть позже.'
  },
  payment_qr: {
    title: '📷 <b>QR-код</b>',
    text: 'QR-код будет добавлен чуть позже.'
  },
  sbkts: {
    title: '🔎 <b>Запросить скрин СБКТС</b>',
    text: [
      'Поможем проверить исходные данные автомобиля и сопроводим оформление СБКТС.',
      '',
      'Для предварительной проверки подготовьте VIN и имеющиеся документы на автомобиль. Точный перечень документов, стоимость и срок сообщит специалист.'
    ].join('\n')
  },
  epts: {
    title: '📄 <b>Получить ЭПТС по VIN</b>',
    text: [
      'Отправьте специалисту VIN автомобиля. Мы проверим наличие электронного паспорта и сообщим результат.',
      '',
      '<i>VIN обычно содержит 17 символов. Проверьте его перед отправкой.</i>'
    ].join('\n')
  },
  owner: {
    title: '👤 <b>Внести собственника в ЭПТС</b>',
    text: [
      'Поможем проверить статус электронного паспорта и внести сведения о собственнике.',
      '',
      'Для предварительной проверки понадобятся VIN и номер ЭПТС. Остальной перечень документов специалист уточнит для вашей ситуации.'
    ].join('\n')
  },
  contact: {
    title: '💬 <b>Чат</b>',
    text: 'Если у вас остались вопросы, напишите нам: @grani_broker'
  },
  donate: {
    title: '❤️ <b>Задонатить</b>',
    text: env => env.DONATE_CARD
      ? [
          'Спасибо, что хотите поддержать развитие сервиса!',
          '',
          'Номер карты:',
          `<code>${escapeHtml(env.DONATE_CARD)}</code>`,
          '',
          'Спасибо за поддержку ❤️'
        ].join('\n')
      : 'Номер карты временно недоступен. Пожалуйста, попробуйте позже.'
  }
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function menuKeyboard(env) {
  const app = env.MINI_APP_URL || 'https://4000680.github.io/grani_miniapp2/';
  return {
    inline_keyboard: [
      [{ text: '♻️ Рассчитать утильсбор', web_app: { url: app + 'tabs/utilsbor/index.html' } }],
      [{ text: '📅 Рассчитать пени', web_app: { url: app + 'tabs/utilsbor/index.html?mode=peni' } }],
      [{ text: '📎 Рассчитать по СБКТС или ЭПТС', callback_data: 'info:pdf' }],
      [{ text: '💳 Реквизиты для оплаты утильсбора', callback_data: 'info:payment' }],
      [{ text: '📄 Получить ЭПТС по VIN', callback_data: 'info:epts' }],
      [{ text: '🔎 Запросить скрин СБКТС', callback_data: 'info:sbkts' }],
      [{ text: '👤 Внести собственника в ЭПТС', callback_data: 'info:owner' }],
      [
        { text: '💬 Чат', callback_data: 'info:contact' },
        { text: '❤️ Задонатить', callback_data: 'info:donate' }
      ]
    ]
  };
}

function infoKeyboard(section, env) {
  const rows = [];
  if (section === 'payment') {
    rows.push([
      { text: '💳 Реквизиты', callback_data: 'info:payment_details' },
      { text: '📷 QR-код', callback_data: 'info:payment_qr' }
    ]);
  }
  if (section === 'contact') {
    rows.push([{
      text: '💬 Написать @grani_broker',
      url: env.CONTACT_URL || 'https://t.me/grani_broker'
    }]);
  }
  if (section === 'payment_details' || section === 'payment_qr') {
    rows.push([{ text: '‹ Вернуться к способам оплаты', callback_data: 'info:payment' }]);
  } else {
    rows.push([{ text: '‹ Вернуться в меню', callback_data: 'menu' }]);
  }
  return { inline_keyboard: rows };
}

async function telegram(env, method, data) {
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`${method}: ${result.description || 'Telegram API error'}`);
  return result.result;
}

function formatMoney(value, precise = false) {
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: precise ? 2 : 0,
    maximumFractionDigits: precise ? 2 : 0
  }) + ' ₽';
}

function formatDate(date) {
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function ageLabel(age) {
  return age === 'new' ? 'до 3 лет' : 'старше 3 лет';
}

function nextDay(date) {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

function formatPeniCompact(cases, deadline, target) {
  if (target <= deadline) {
    return `Пени пока нет. Начнут начисляться с <b>${formatDate(nextDay(deadline))}</b>.`;
  }
  const lines = [];
  for (const item of cases) {
    const result = calculatePeni(item.sum, deadline, target);
    const prefix = cases.length > 1 ? `${item.label}: ` : '';
    lines.push(`<b>Просрочка:</b> ${result.days} календарных дн.`);
    lines.push(`${prefix}<b>Пени на ${formatDate(target)}: ${formatMoney(result.total, true)}</b>`);
    lines.push(`<b>Итого к оплате: ${formatMoney(item.sum + result.total, true)}</b>`);
  }
  return lines.join('\n');
}

function formatDocumentResult(vehicle, util, deadline = null, target = todayUtc()) {
  const title = vehicle.type === 'sbkts' ? 'СБКТС распознан' : 'Выписка ЭПТС распознана';
  const lines = [
    `✅ <b>${title}</b>`,
    '',
    `<b>Автомобиль:</b> ${escapeHtml([vehicle.brand, vehicle.model].filter(Boolean).join(' ') || '—')}`,
    `<b>Год выпуска:</b> ${vehicle.year}`,
    `<b>Категория:</b> ${escapeHtml(vehicle.category)}`,
  ];
  if (vehicle.hybridType) lines.push(`<b>Тип гибрида:</b> ${escapeHtml(vehicle.hybridType)}`);
  lines.push('', `<b>Объём двигателя:</b> ${vehicle.ccm ? `${vehicle.ccm} см³` : 'электро/гибрид'}`, `<b>Мощность:</b> ${vehicle.totalKw} кВт`);
  if (vehicle.electricKw.length) {
    lines.push(`<i>${vehicle.combustionKw || 0} кВт ДВС + ${vehicle.electricKw.join(' + ')} кВт электромоторы</i>`);
  }
  lines.push('');
  for (const item of util) {
    if (item.personal !== item.commercial) {
      lines.push(`<b>${ageLabel(item.age)}</b>`);
      lines.push(`<b>Утилизационный сбор: ${formatMoney(item.personal)}</b>`);
      lines.push(`Коммерческая ставка: ${formatMoney(item.commercial)}`);
    } else {
      lines.push(`<b>${ageLabel(item.age)}</b>`);
      lines.push(`<b>Утилизационный сбор: ${formatMoney(item.commercial)}</b>`);
      lines.push('<i>Льготная ставка для личного пользования не применяется.</i>');
    }
  }
  if (deadline) {
    lines.push(
      '',
      `<b>Дата оформления СБКТС:</b> ${formatDate(vehicle.issueDate)}`,
      'Срок подачи документов и уплаты: <b>5 рабочих дней</b> с даты оформления СБКТС (праздники РФ учтены).',
      `<b>Крайний срок уплаты: ${formatDate(deadline)}</b>`,
      formatPeniCompact(peniCases(util), deadline, target)
    );
  }
  return lines.join('\n');
}

function peniCases(util) {
  return util.map(item => ({ label: ageLabel(item.age), sum: item.personal }));
}

function encodeCases(cases) {
  if (cases.length === 1) return `Сумма утильсбора: ${formatMoney(cases[0].sum)}`;
  return cases.map(item => `${item.label}: ${formatMoney(item.sum)}`).join('\n');
}

function extractCases(text) {
  const result = [];
  const pattern = /(до 3 лет|старше 3 лет):\s*([\d\s ]+)\s*₽/gi;
  for (const match of text.matchAll(pattern)) result.push({ label: match[1].toLowerCase(), sum: Number(match[2].replace(/\s| /g, '')) });
  if (result.length) return result;
  const single = text.match(/Сумма утильсбора:\s*([\d\s ]+)\s*₽/i);
  return single ? [{ label: '', sum: Number(single[1].replace(/\s| /g, '')) }] : [];
}

function applicationFromVehicle(vehicle, util) {
  const amounts = util.map(item => item.personal !== item.commercial ? item.personal : item.commercial);
  return {
    source: vehicle.type === 'sbkts' ? 'СБКТС' : vehicle.type === 'catalog' ? 'Справочник' : 'ЭПТС',
    vin: vehicle.vin,
    surname: vehicle.surname,
    brand: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    category: vehicle.category,
    kw: vehicle.totalKw,
    ccm: vehicle.ccm,
    amount: amounts.length === 1 ? amounts[0] : null,
    amountLabel: amounts.length > 1 ? amounts.map(formatMoney).join(' / ') : ''
  };
}

function applicationsStub(env, userId) {
  if (!env.APPLICATIONS || !userId) return null;
  return env.APPLICATIONS.getByName(String(userId));
}

async function saveApplication(env, userId, application) {
  const stub = applicationsStub(env, userId);
  if (!stub) return;
  try { await stub.add(application); } catch (error) { console.error('Applications storage:', error); }
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function authenticateMiniApp(request, env) {
  const initData = request.headers.get('x-telegram-init-data') || '';
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash') || '';
  params.delete('hash');
  if (!receivedHash || !env.BOT_TOKEN) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 7 * 24 * 60 * 60) return null;
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const encoder = new TextEncoder();
  const webAppKey = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', webAppKey, encoder.encode(env.BOT_TOKEN));
  const secretKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expectedHash = bytesToHex(await crypto.subtle.sign('HMAC', secretKey, encoder.encode(dataCheckString)));
  if (!safeEqual(expectedHash, receivedHash.toLowerCase())) return null;
  try {
    const user = JSON.parse(params.get('user') || '{}');
    return user.id ? user : null;
  } catch (_) { return null; }
}

function apiHeaders(env) {
  let origin = 'https://4000680.github.io';
  try { origin = new URL(env.MINI_APP_URL).origin; } catch (_) {}
  return {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-telegram-init-data',
    'cache-control': 'no-store'
  };
}

async function handleApplicationsApi(request, env) {
  const headers = apiHeaders(env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const user = await authenticateMiniApp(request, env);
  if (!user) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers });
  const stub = applicationsStub(env, user.id);
  if (!stub) return new Response(JSON.stringify({ ok: false, error: 'Storage unavailable' }), { status: 503, headers });
  if (request.method === 'GET') return new Response(JSON.stringify({ ok: true, items: await stub.list() }), { headers });
  if (request.method === 'POST') {
    const body = await request.json();
    return new Response(JSON.stringify({ ok: true, items: await stub.add(body) }), { headers });
  }
  if (request.method === 'DELETE') return new Response(JSON.stringify({ ok: true, items: await stub.clear() }), { headers });
  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers });
}

function parseDateFromPrompt(text, label) {
  const match = text.match(new RegExp(`${label}:\\s*(\\d{2}\\.\\d{2}\\.\\d{4})`, 'i'));
  return match ? parseFlexibleDate(match[1]) : null;
}

function encodePeniCallback(cases, deadline) {
  return `calc:peni:${deadline.toISOString().slice(0, 10)}:${cases.map(item => item.sum).join(',')}`;
}

function calculationKeyboard(cases = [], deadline = null) {
  const rows = [];
  if (deadline) rows.push([{ text: '📅 Рассчитать пени на другую дату', callback_data: encodePeniCallback(cases, deadline) }]);
  rows.push([
    { text: '🔄 Новый расчёт', callback_data: 'calc:new' },
    { text: '🏠 Главное меню', callback_data: 'calc:menu' }
  ]);
  return { inline_keyboard: rows };
}

async function sendIssueDatePrompt(env, chatId, cases) {
  return telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: [
      'Чтобы рассчитать пени, нужна дата оформления СБКТС.',
      'Введите её ответом на это сообщение в любом привычном формате.',
      '',
      encodeCases(cases),
      '',
      '<i>Например: 02.09.2026 или 2 сентября 2026</i>'
    ].join('\n'),
    parse_mode: 'HTML',
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Дата оформления СБКТС' }
  });
}

async function sendPlannedDatePrompt(env, chatId, cases, deadline) {
  return telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: [
      'Планируете подать документы позже?',
      'Введите предполагаемую дату ответом на это сообщение — я пересчитаю пени точно на этот день.',
      '',
      `Крайний срок: ${formatDate(deadline)}`,
      encodeCases(cases)
    ].join('\n'),
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Предполагаемая дата подачи' }
  });
}

async function handleDateReply(env, message) {
  const prompt = message.reply_to_message?.text || '';
  const date = parseFlexibleDate(message.text);
  if (!prompt || (!prompt.startsWith('Чтобы рассчитать пени') && !prompt.startsWith('Планируете подать документы позже'))) return false;
  const cases = extractCases(prompt);
  if (!date || !cases.length) {
    await telegram(env, 'sendMessage', { chat_id: message.chat.id, text: 'Не удалось распознать дату. Попробуйте ещё раз.' });
    if (prompt.startsWith('Чтобы рассчитать пени')) await sendIssueDatePrompt(env, message.chat.id, cases);
    else {
      const deadline = parseDateFromPrompt(prompt, 'Крайний срок');
      if (deadline) await sendPlannedDatePrompt(env, message.chat.id, cases, deadline);
    }
    return true;
  }
  if (prompt.startsWith('Чтобы рассчитать пени')) {
    const deadline = addWorkingDays(date, 5);
    await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: [`<b>Крайний срок уплаты: ${formatDate(deadline)}</b>`, formatPeniCompact(cases, deadline, todayUtc())].join('\n'),
      parse_mode: 'HTML',
      reply_markup: calculationKeyboard(cases, deadline)
    });
  } else {
    const deadline = parseDateFromPrompt(prompt, 'Крайний срок');
    if (!deadline) throw new Error('Не удалось восстановить крайний срок из сообщения');
    await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: [`<b>Крайний срок уплаты: ${formatDate(deadline)}</b>`, formatPeniCompact(cases, deadline, date)].join('\n'),
      parse_mode: 'HTML',
      reply_markup: calculationKeyboard(cases, deadline)
    });
  }
  return true;
}


const CATALOG_CCM_BUCKETS = [
  { value: 800, label: 'до 1000 см³' },
  { value: 1500, label: '1001–2000 см³' },
  { value: 2500, label: '2001–3000 см³' },
  { value: 3200, label: '3001–3500 см³' },
  { value: 4000, label: 'свыше 3500 см³' }
];

function compactButtonText(value, max = 58) {
  const text = String(value);
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

function catalogCandidateDescription(candidate) {
  const power = [];
  if (candidate.combustionKw) power.push(candidate.combustionKw + ' кВт макс.');
  if (candidate.electricKw) power.push(candidate.electricKw + ' кВт (30 мин)');
  return [
    '<b>' + escapeHtml([candidate.brand, candidate.model].filter(Boolean).join(' ')) + '</b>, ' + candidate.year,
    power.length ? 'Мощность в справочнике: ' + power.join(' + ') : 'Мощность в справочнике не указана',
    candidate.mass ? 'Технически допустимая масса: ' + candidate.mass + ' кг' : ''
  ].filter(Boolean).join('\n');
}

function catalogVariantsKeyboard(matches) {
  return {
    inline_keyboard: [
      ...matches.map(candidate => [{
        text: compactButtonText(
          candidate.brand + ' ' + candidate.model + ' · ' +
          (candidate.combustionKw || 0) +
          (candidate.electricKw ? ' + ' + candidate.electricKw : '') + ' кВт'
        ),
        callback_data: 'catalog:pick:' + candidate.rowIndex
      }]),
      [{ text: '🏠 Главное меню', callback_data: 'calc:menu' }]
    ]
  };
}

function catalogEngineKeyboard(rowIndex) {
  const buttons = CATALOG_CCM_BUCKETS.map(bucket => ({
    text: bucket.label,
    callback_data: 'catalog:calc:' + rowIndex + ':' + bucket.value
  }));
  return {
    inline_keyboard: [
      buttons.slice(0, 2),
      buttons.slice(2, 4),
      [buttons[4], { text: '⚡ Электро/гибрид', callback_data: 'catalog:calc:' + rowIndex + ':e' }],
      [{ text: '🏠 Главное меню', callback_data: 'calc:menu' }]
    ]
  };
}

function catalogEnginePrompt(candidate) {
  return [
    '✅ <b>Автомобиль найден в справочнике</b>',
    '',
    catalogCandidateDescription(candidate),
    '',
    'Выберите тип автомобиля и группу объёма двигателя.',
    '',
    '<i>Для электромобиля или последовательного гибрида выберите «Электро/гибрид»: в расчёт пойдёт только 30-минутная мощность.</i>'
  ].join('\n');
}

function catalogNoPreferenceReason(ccm, kw) {
  if (!ccm) return 'мощность выше 58,84 кВт (80 л.с.)';
  if (ccm > 3000) return 'объём двигателя превышает 3000 см³';
  return 'мощность выше 117,68 кВт (160 л.с.)';
}

function formatCatalogResult(candidate, vehicle, util) {
  const electric = !vehicle.ccm;
  const lines = [
    '✅ <b>Расчёт утильсбора</b>',
    '',
    '<b>Автомобиль:</b> ' + escapeHtml([candidate.brand, candidate.model].filter(Boolean).join(' ')),
    '<b>Год выпуска:</b> ' + candidate.year,
    '<b>Тип:</b> ' + (electric ? 'электромобиль / последовательный гибрид' : 'ДВС / параллельный гибрид'),
    '<b>Мощность для расчёта:</b> ' + vehicle.totalKw + ' кВт' + (electric ? ' (30-минутная)' : ''),
  ];
  if (!electric) {
    lines.push('<b>Объём двигателя:</b> группа ' + vehicle.ccm + ' см³');
    if (candidate.electricKw) {
      lines.push('<i>' + candidate.combustionKw + ' кВт максимальная + ' + candidate.electricKw + ' кВт 30-минутная</i>');
    }
  }
  lines.push('');
  for (const item of util) {
    lines.push('<b>' + ageLabel(item.age) + ':</b>');
    if (item.personal !== item.commercial) {
      lines.push('<b>Льготный утильсбор для физлица: ' + formatMoney(item.personal) + '</b>');
      lines.push('Коммерческий утильсбор: ' + formatMoney(item.commercial));
    } else {
      lines.push('<b>Коммерческий утильсбор: ' + formatMoney(item.commercial) + '</b>');
      lines.push('<i>Льготный коэффициент не применяется: ' + catalogNoPreferenceReason(vehicle.ccm, vehicle.totalKw) + '.</i>');
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

async function showCatalogCandidate(env, message, rowIndex) {
  const catalog = await loadCatalog(env.CATALOG_URL);
  const candidate = getCatalogCandidate(catalog, rowIndex);
  if (!candidate) throw new Error('Выбранная версия автомобиля больше не найдена в справочнике');
  await telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: catalogEnginePrompt(candidate),
    parse_mode: 'HTML',
    reply_markup: catalogEngineKeyboard(candidate.rowIndex)
  });
}

async function handleCatalogText(env, message) {
  if (message.chat?.type !== 'private' || message.text.startsWith('/')) return false;
  const parsed = parseCatalogQuery(message.text);
  if (!parsed) return false;

  await telegram(env, 'sendChatAction', { chat_id: message.chat.id, action: 'typing' });
  const status = await telegram(env, 'sendMessage', {
    chat_id: message.chat.id,
    text: '🔎 Ищу автомобиль в справочнике…'
  });

  try {
    const catalog = await loadCatalog(env.CATALOG_URL);
    const matches = searchCatalog(catalog, parsed);
    if (!matches.length) {
      await telegram(env, 'editMessageText', {
        chat_id: message.chat.id,
        message_id: status.message_id,
        text: [
          'Не нашёл такой автомобиль в справочнике.',
          '',
          'Попробуйте написать марку и модель точнее, например: <b>Kia Niro EV 2022</b>.'
        ].join('\n'),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Главное меню', callback_data: 'calc:menu' }]] }
      });
      return true;
    }

    if (matches.length === 1) {
      await showCatalogCandidate(env, status, matches[0].rowIndex);
      return true;
    }

    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: status.message_id,
      text: 'Нашёл несколько вариантов. Выберите подходящую мощность:',
      reply_markup: catalogVariantsKeyboard(matches)
    });
  } catch (error) {
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: status.message_id,
      text: 'Не удалось выполнить поиск: ' + escapeHtml(error.message || error) + '. Попробуйте ещё раз немного позже.',
      parse_mode: 'HTML'
    });
  }
  return true;
}

async function handleCatalogCallback(env, query) {
  const message = query.message;
  const pick = query.data.match(/^catalog:pick:(\d+)$/);
  if (pick) {
    await showCatalogCandidate(env, message, Number(pick[1]));
    return;
  }

  const calculation = query.data.match(/^catalog:calc:(\d+):(e|\d+)$/);
  if (!calculation) return;
  const catalog = await loadCatalog(env.CATALOG_URL);
  const candidate = getCatalogCandidate(catalog, Number(calculation[1]));
  if (!candidate) throw new Error('Автомобиль больше не найден в справочнике');

  const electric = calculation[2] === 'e';
  const ccm = electric ? null : Number(calculation[2]);
  const totalKw = calculationPower(candidate, electric);
  const vehicle = {
    type: 'catalog',
    brand: candidate.brand,
    model: candidate.model,
    vin: null,
    surname: null,
    year: candidate.year,
    category: 'M1',
    ccm,
    combustionKw: candidate.combustionKw,
    electricKw: candidate.electricKw ? [candidate.electricKw] : [],
    totalKw,
    maxMass: candidate.mass,
    issueDate: null,
    hybridType: electric ? 'электромобиль / последовательный гибрид' : 'ДВС / параллельный гибрид'
  };
  const util = calculateUtil(vehicle);
  await saveApplication(env, query.from?.id, applicationFromVehicle(vehicle, util));
  await telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: formatCatalogResult(candidate, vehicle, util),
    parse_mode: 'HTML',
    reply_markup: calculationKeyboard()
  });
}

async function handleDocument(env, message) {
  const document = message.document;
  const isPdf = document.mime_type === 'application/pdf' || /\.pdf$/i.test(document.file_name || '');
  if (!isPdf) {
    await telegram(env, 'sendMessage', { chat_id: message.chat.id, text: 'Пожалуйста, отправьте документ в формате PDF.' });
    return;
  }
  if (document.file_size > 20 * 1024 * 1024) {
    await telegram(env, 'sendMessage', { chat_id: message.chat.id, text: 'Файл больше 20 МБ. Telegram не позволяет боту скачать такой документ.' });
    return;
  }
  await telegram(env, 'sendChatAction', { chat_id: message.chat.id, action: 'typing' });
  const status = await telegram(env, 'sendMessage', { chat_id: message.chat.id, text: '📄 Читаю документ и рассчитываю утильсбор…' });
  try {
    const file = await telegram(env, 'getFile', { file_id: document.file_id });
    const response = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`);
    if (!response.ok) throw new Error('Telegram не отдал файл для скачивания');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const parsedDocument = await readPdf(bytes);
    if (parsedDocument.text.replace(/\s/g, '').length < 40) throw new Error('В PDF нет текстового слоя');
    const vehicle = parseVehicleDocument(parsedDocument);
    const util = calculateUtil(vehicle);
    const cases = peniCases(util);
    const deadline = vehicle.issueDate ? addWorkingDays(vehicle.issueDate, 5) : null;
    const result = formatDocumentResult(vehicle, util, deadline);
    await saveApplication(env, message.from?.id, applicationFromVehicle(vehicle, util));
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: status.message_id,
      text: result,
      parse_mode: 'HTML',
      reply_markup: calculationKeyboard(cases, deadline)
    });
    if (!vehicle.issueDate) await sendIssueDatePrompt(env, message.chat.id, cases);
  } catch (error) {
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: status.message_id,
      text: `Не удалось обработать документ: ${escapeHtml(error.message || error)}. Убедитесь, что это СБКТС или выписка ЭПТС с текстовым слоем.`,
      parse_mode: 'HTML'
    });
  }
}

function isGroupChat(chat) {
  return chat?.type === 'group' || chat?.type === 'supergroup';
}

function isPdfDocument(document) {
  return document && (document.mime_type === 'application/pdf' || /\.pdf$/i.test(document.file_name || ''));
}

async function offerGroupCalculation(env, message) {
  if (!isPdfDocument(message.document)) return;
  const tooLarge = message.document.file_size > 20 * 1024 * 1024;
  return telegram(env, 'sendMessage', {
    chat_id: message.chat.id,
    text: tooLarge
      ? '📄 PDF-файл больше 20 МБ — бот не сможет скачать его для расчёта.'
      : '📄 PDF-документ получен. Рассчитать утилизационный сбор?',
    reply_parameters: {
      message_id: message.message_id,
      allow_sending_without_reply: false
    },
    reply_markup: tooLarge ? undefined : {
      inline_keyboard: [[{ text: '🧮 Рассчитать утильсбор', callback_data: 'group:calculate' }]]
    }
  });
}

async function handleGroupCalculation(env, query) {
  const botMessage = query.message;
  const sourceMessage = botMessage?.reply_to_message;
  if (!isGroupChat(botMessage?.chat) || !isPdfDocument(sourceMessage?.document)) {
    await telegram(env, 'answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Исходный PDF-файл больше недоступен.',
      show_alert: true
    });
    return;
  }

  await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Рассчитываю…' });
  await telegram(env, 'editMessageText', {
    chat_id: botMessage.chat.id,
    message_id: botMessage.message_id,
    text: '📄 Читаю документ и рассчитываю утильсбор…',
    reply_markup: { inline_keyboard: [] }
  });

  try {
    const document = sourceMessage.document;
    if (document.file_size > 20 * 1024 * 1024) throw new Error('Файл больше 20 МБ');
    const file = await telegram(env, 'getFile', { file_id: document.file_id });
    const response = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`);
    if (!response.ok) throw new Error('Telegram не отдал файл для скачивания');
    const parsedDocument = await readPdf(new Uint8Array(await response.arrayBuffer()));
    if (parsedDocument.text.replace(/\s/g, '').length < 40) throw new Error('В PDF нет текстового слоя');
    const vehicle = parseVehicleDocument(parsedDocument);
    const util = calculateUtil(vehicle);
    const deadline = vehicle.issueDate ? addWorkingDays(vehicle.issueDate, 5) : null;
    await saveApplication(env, query.from?.id, applicationFromVehicle(vehicle, util));
    await telegram(env, 'editMessageText', {
      chat_id: botMessage.chat.id,
      message_id: botMessage.message_id,
      text: formatDocumentResult(vehicle, util, deadline),
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] }
    });
  } catch (error) {
    await telegram(env, 'editMessageText', {
      chat_id: botMessage.chat.id,
      message_id: botMessage.message_id,
      text: `Не удалось обработать документ: ${escapeHtml(error.message || error)}. Убедитесь, что это СБКТС или выписка ЭПТС с текстовым слоем.`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] }
    });
  }
}

async function sendMenu(env, chatId) {
  return telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: MENU_TEXT,
    parse_mode: 'HTML',
    reply_markup: menuKeyboard(env)
  });
}

async function editMenu(env, message) {
  return telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: MENU_TEXT,
    parse_mode: 'HTML',
    reply_markup: menuKeyboard(env)
  });
}

async function showInfo(env, message, section) {
  const info = INFO[section];
  if (!info) return;
  const text = typeof info.text === 'function' ? info.text(env) : info.text;
  return telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: `${info.title}\n\n${text}`,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: infoKeyboard(section, env)
  });
}

async function handleCalculationCallback(env, query) {
  const message = query.message;
  if (query.data === 'calc:menu') {
    await telegram(env, 'deleteMessage', { chat_id: message.chat.id, message_id: message.message_id });
    await sendMenu(env, message.chat.id);
    return;
  }
  if (query.data === 'calc:new') {
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: '📎 Отправьте новый PDF-файл СБКТС или выписку ЭПТС либо напишите марку, модель и год автомобиля, например: Kia Niro EV 2022.',
      reply_markup: { inline_keyboard: [[{ text: '🏠 Главное меню', callback_data: 'calc:menu' }]] }
    });
    return;
  }
  const match = query.data.match(/^calc:peni:(\d{4}-\d{2}-\d{2}):([\d,]+)$/);
  if (!match) return;
  const deadline = parseFlexibleDate(match[1]);
  const sums = match[2].split(',').map(Number).filter(Boolean);
  const labels = sums.length > 1 ? ['до 3 лет', 'старше 3 лет'] : [''];
  const cases = sums.map((sum, index) => ({ label: labels[index] || '', sum }));
  await telegram(env, 'deleteMessage', { chat_id: message.chat.id, message_id: message.message_id });
  await sendPlannedDatePrompt(env, message.chat.id, cases, deadline);
}

async function handleUpdate(env, update) {
  if (update.message?.document) {
    if (isGroupChat(update.message.chat)) await offerGroupCalculation(env, update.message);
    else await handleDocument(env, update.message);
    return;
  }
  if (update.message?.text) {
    if (await handleDateReply(env, update.message)) return;
    const command = update.message.text.split(/\s+/)[0].split('@')[0].toLowerCase();
    if (command === '/start' || command === '/menu' || command === '/help') {
      await sendMenu(env, update.message.chat.id);
      return;
    }
    if (await handleCatalogText(env, update.message)) return;
    return;
  }

  const query = update.callback_query;
  if (!query) return;
  if (query.data === 'group:calculate') {
    await handleGroupCalculation(env, query);
    return;
  }
  await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id });
  if (!query.message) return;
  if (query.data?.startsWith('catalog:')) await handleCatalogCallback(env, query);
  else if (query.data?.startsWith('calc:')) await handleCalculationCallback(env, query);
  else if (query.data === 'menu') await editMenu(env, query.message);
  else if (query.data?.startsWith('info:')) await showInfo(env, query.message, query.data.slice(5));
}

async function setupBot(request, env) {
  if (!env.SETUP_KEY) return new Response('Setup is disabled', { status: 404 });
  const url = new URL(request.url);
  if (url.pathname !== `/setup/${env.SETUP_KEY}`) return new Response('Not found', { status: 404 });
  if (!env.WEBHOOK_SECRET) return new Response('WEBHOOK_SECRET is not configured', { status: 500 });

  const webhookUrl = `${url.origin}/webhook`;
  const webhook = await telegram(env, 'setWebhook', {
    url: webhookUrl,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false
  });
  await telegram(env, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Открыть главное меню' },
      { command: 'menu', description: 'Показать кнопки' },
      { command: 'help', description: 'Помощь' }
    ]
  });
  return Response.json({ ok: true, webhook, webhook_url: webhookUrl });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/applications') return handleApplicationsApi(request, env);
      if (request.method === 'GET' && url.pathname.startsWith('/setup/')) return setupBot(request, env);
      if (request.method === 'GET' && url.pathname === '/') {
        return Response.json({ ok: true, service: 'grani-telegram-bot', version: 'catalog-search-v1' });
      }
      if (request.method !== 'POST' || url.pathname !== '/webhook') return new Response('Not found', { status: 404 });
      if (!env.WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) {
        return new Response('Forbidden', { status: 403 });
      }
      const update = await request.json();
      ctx.waitUntil(handleUpdate(env, update).catch(error => console.error(error)));
      return new Response('OK');
    } catch (error) {
      console.error(error);
      return new Response('Internal error', { status: 500 });
    }
  }
};
