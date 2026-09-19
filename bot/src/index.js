Warning: truncated output (original token count: 33558)
Total output lines: 2996

import {
  calculationPower,
  getCatalogCandidate,
  getCatalogVariants,
  listCatalogModifications,
  listCatalogSuggestions,
  loadCatalog,
  paginateCatalogModifications,
  paginateCatalogVariants,
  parseCatalogQuery,
  parseCatalogWeight,
  searchCatalog
} from './catalog-search.js';
import {
  addWorkingDays,
  calculatePeni,
  calculateUtil,
  DocumentProcessingError,
  parseFlexibleDate,
  processVehicleDocument,
  todayUtc
} from './document-processing.js';
import {
  calculateCustomsProcessingFee,
  calculateElectricCustoms,
  calculatePassengerOver3,
  calculatePassengerUnder3,
  calculatePickup,
  convertCurrencyToRub,
  parseCbrCurrencyRate,
  parseCbrEuroRate,
  parsePositiveNumber
} from './customs-calculation.js';
import { electricCustomsPowerDetails } from './electric-customs-flow.js';
import { isPermanentResultText } from './message-policy.js';
export { ApplicationsStore } from './applications-store.js';

const { hybridTypeLabel } = globalThis.GraniVehiclePower;

const START_MENU_TEXT = [
  'Здравствуйте! Я — помощник компании «Брокер Грани» 🚗',
  '',
  'Мы создали этот бот, чтобы автоматизировать ежедневные задачи брокера и упростить оформление автомобилей по параллельному импорту.',
  '',
  '📟 Для расчёта утильсбора отправьте PDF-файл СБКТС или выписку ЭПТС.',
  '',
  '🎛️ Для поиска по шаблону СЭП напишите марку, модель и год выпуска.',
  '',
  'Также вы можете выбрать нужный раздел в меню ниже.',
  '',
  'Функционал бота постоянно пополняется 🎮'
].join('\n');

const MENU_TEXT = [
  '📟 Для расчёта утильсбора отправьте PDF-файл СБКТС или выписку ЭПТС.',
  '',
  '🎛️ Для поиска по шаблону СЭП напишите марку, модель и год выпуска.',
  '',
  'Также вы можете выбрать нужный раздел в меню ниже.',
  '',
  'Функционал бота постоянно пополняется 🎮'
].join('\n');

const OVER3_CUSTOMS_FEE_BRACKETS = [
  { id: '450-1200', label: '450 тыс. – 1,2 млн ₽', fee: 4924 },
  { id: '1200-2700', label: '1,2 – 2,7 млн ₽', fee: 13541 },
  { id: '2700-4200', label: '2,7 – 4,2 млн ₽', fee: 18465 },
  { id: '4200-5500', label: '4,2 – 5,5 млн ₽', fee: 21344 },
  { id: '5500-10000', label: '5,5 – 10 млн ₽', fee: 49240 },
  { id: '10000-plus', label: 'Свыше 10 млн ₽', fee: 73860 }
];

const INFO = {
  pdf: {
    title: '📎 <b>Расчёт по документу</b>',
    text: 'Отправьте в этот чат PDF-файл СБКТС или выписку ЭПТС — можно просто переслать документ из другого чата. 🛞'
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
    title: '☎️ <b>Техподдержка</b>',
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
      [{ text: '🚗 Таможенное оформление', callback_data: 'customs:start' }],
      [{ text: '🛞 Рассчитать утильсбор', web_app: { url: app + 'tabs/utilsbor/index.html' } }],
      [{ text: '📅 Рассчитать пени', web_app: { url: app + 'tabs/utilsbor/index.html?mode=peni' } }],
      [{ text: '📟 Рассчитать по СБКТС или ЭПТС', callback_data: 'info:pdf' }],
      [{ text: '💳 Реквизиты для оплаты утильсбора', callback_data: 'info:payment' }],
      [{ text: '📄 Получить ЭПТС по VIN', callback_data: 'info:epts' }],
      [{ text: '🔎 Запросить скрин СБКТС', callback_data: 'info:sbkts' }],
      [{ text: '👤 Внести собственника в ЭПТС', callback_data: 'info:owner' }],
      [
        { text: '☎️ Техподдержка', callback_data: 'info:contact' },
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
      text: '☎️ Написать @grani_broker',
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

let cachedEuroRate = null;
let cachedEuroRateAt = 0;
let cachedCurrencyXml = null;
let cachedCurrencyXmlAt = 0;

const ELECTRIC_CUSTOMS_CURRENCIES = {
  RUB: { button: '🇷🇺 Рубли', name: 'российских рублях', code: 'RUB', symbol: '₽' },
  USD: { button: '🇺🇸 Доллары', name: 'долларах США', code: 'USD', symbol: '$' },
  EUR: { button: '🇪🇺 Евро', name: 'евро', code: 'EUR', symbol: '€' },
  CNY: { button: '🇨🇳 Юани', name: 'китайских юанях', code: 'CNY', symbol: '¥' },
  KRW: { button: '🇰🇷 Воны', name: 'корейских вонах', code: 'KRW', symbol: '₩' }
};

async function euroRate(env) {
  const configured = parsePositiveNumber(env.EUR_RATE);
  if (configured) return configured;
  if (cachedEuroRate && Date.now() - cachedEuroRateAt < 6 * 60 * 60 * 1000) return cachedEuroRate;
  const response = await fetch('https://www.cbr.ru/scripts/XML_daily.asp');
  if (!response.ok) throw new Error('не удалось получить курс евро ЦБ РФ');
  const parsed = parseCbrEuroRate(await response.text());
  if (!parsed) throw new Error('не удалось прочитать курс евро ЦБ РФ');
  cachedEuroRate = parsed;
  cachedEuroRateAt = Date.now();
  return parsed;
}

function electricCustomsCurrency(code) {
  return ELECTRIC_CUSTOMS_CURRENCIES[String(code || '').toUpperCase()] || null;
}

async function cbrCurrencyRate(code) {
  const currency = electricCustomsCurrency(code);
  if (!currency) throw new Error('неизвестная валюта');
  if (currency.code === 'RUB') return parseCbrCurrencyRate('', 'RUB');
  if (!cachedCurrencyXml || Date.now() - cachedCurrencyXmlAt >= 6 * 60 * 60 * 1000) {
    const response = await fetch('https://www.cbr.ru/scripts/XML_daily.asp');
    if (!response.ok) throw new Error('не удалось получить курс валют ЦБ РФ');
    cachedCurrencyXml = await response.text();
    cachedCurrencyXmlAt = Date.now();
  }
  const rate = parseCbrCurrencyRate(cachedCurrencyXml, currency.code);
  if (!rate) throw new Error(`не удалось прочитать курс ${currency.code} ЦБ РФ`);
  return rate;
}

function formatCurrencyAmount(value, code) {
  const currency = electricCustomsCurrency(code);
  const amount = Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return currency?.code === 'RUB' ? `${amount} ₽` : `${amount} ${currency?.code || code}`;
}

function formatCbrRate(rate) {
  const nominal = Number(rate.nominal).toLocaleString('ru-RU');
  const value = Number(rate.value).toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  return `Курс ЦБ РФ${rate.date ? ` на ${rate.date}` : ''}: ${nominal} ${rate.code} = ${value} ₽`;
}

function customsValueLines(enteredValue, currency, currencyRate, valueRub) {
  return [
    `<b>Указанная стоимость:</b> ${formatCurrencyAmount(enteredValue, currency.code)}`,
    ...(currency.code === 'RUB' ? [] : [
      formatCbrRate(currencyRate),
      `<b>Таможенная стоимость в рублях:</b> ${formatMoney(valueRub)}`
    ])
  ];
}

async function resolveCustomsValue(enteredValue, currencyCode) {
  const currency = electricCustomsCurrency(currencyCode || 'RUB');
  if (!currency) throw new Error('неизвестная валюта стоимости');
  const currencyRate = await cbrCurrencyRate(currency.code);
  return {
    enteredValue,
    currency,
    currencyRate,
    valueRub: convertCurrencyToRub(enteredValue, currencyRate)
  };
}

function customsKeyboard(rows = [], back = 'customs:start') {
  return {
    inline_keyboard: [
      ...rows,
      [
        { text: '← Назад', callback_data: back },
        { text: '🏠 Главное меню', callback_data: 'menu' }
      ]
    ]
  };
}

function customsIntroText() {
  return [
    '🛃 <b>Таможенное оформление</b>',
    '',
    'Расчёт состоит из таможенного платежа и утилизационного сбора.',
    'Дополнительно учитывается государственный таможенный сбор за операции — его размер зависит от таможенной стоимости автомобиля.',
    '',
    '<i>Расчёт предварительный. Окончательная сумма зависит от таможенной стоимости, которую определяет таможенный орган. Инспектор также может скорректировать стоимость.</i>',
    '',
    'Выберите категорию автомобиля:'
  ].join('\n');
}

function customsIntroKeyboard() {
  return customsKeyboard([
    [{ text: '🚗 Автомобили до 3 лет', callback_data: 'customs:under3' }],
    [{ text: '🛞 Автомобили старше 3 лет', callback_data: 'customs:over3' }],
    [{ text: '🪫 Электро и последовательные гибриды', callback_data: 'customs:electric' }],
    [{ text: '🛻 Пикапы', callback_data: 'customs:pickup' }],
    [{ text: '🎛️ Какой автомобиль выгоднее?', callback_data: 'customs:advice' }],
    [{ text: '☎️ Получить консультацию', callback_data: 'info:contact' }]
  ], 'menu');
}

function customsResultKeyboard(firstRow = null) {
  return {
    inline_keyboard: [
      ...(firstRow ? [firstRow] : []),
      [
        { text: '🔄 Новый расчёт', callback_data: 'customs:result:new' },
        { text: '🏠 Главное меню', callback_data: 'customs:result:menu' }
      ]
    ]
  };
}

const CUSTOMS_EXPENSES_NOTE = '<i>Расчёт предварительный. Дополнительные расходы не включены: услуги таможенного представителя, доставка, СВХ, оформление СБКТС и ЭПТС.</i>';

function appendCustomsUtilSummary(lines, item, baseTotal) {
  lines.push(`<b>Утильсбор — ${ageLabel(item.age)}:</b>`);
  if (item.personal !== item.commercial) {
    lines.push(
      `<b>Льготный утильсбор: ${formatMoney(item.personal)}</b>`,
      `<b>Итого с льготным утильсбором: ${formatMoney(baseTotal + item.personal)}</b>`,
      `<i>Коммерческий утильсбор: ${formatMoney(item.commercial)}</i>`,
      `<i>Итого с коммерческим утильсбором: ${formatMoney(baseTotal + item.commercial)}</i>`
    );
  } else {
    lines.push(
      `<b>Коммерческий утильсбор: ${formatMoney(item.commercial)}</b>`,
      `<b>Итого с коммерческим утильсбором: ${formatMoney(baseTotal + item.commercial)}</b>`
    );
  }
  lines.push('');
}

function under3CustomsResultText(candidate, vehicle, customs, customsFee, util, euroRate, valueDetails) {
  const lines = [
    '✅ <b>Полный расчёт автомобиля до 3 лет</b>',
    '',
    `<b>Автомобиль:</b> ${escapeHtml(candidate.brand + ' ' + candidate.model)}`,
    `<b>Год выпуска:</b> ${candidate.year}`,
    `<b>Мощность:</b> ${vehicle.totalKw} кВт`,
    `<b>Технически допустимая масса:</b> ${vehicle.maxMass || '—'}${vehicle.maxMass ? ' кг' : ''}`,
    `<b>Объём двигателя:</b> ${vehicle.ccm} см³`,
    ...customsValueLines(
      valueDetails.enteredValue,
      valueDetails.currency,
      valueDetails.currencyRate,
      customs.customsValueRub
    ),
    ''
  ];

  if (customs.selectedBy === 'minimum') {
    lines.push(
      `<b>По единой ставке ${customs.percent}%:</b> ${formatMoney(customs.percentageAmount)}`,
      `<b>Минимальный платёж ${customs.minEuroPerCc} €/см³:</b> ${formatMoney(customs.minimumAmount)}`,
      `<b>Таможенный платёж:</b> ${formatMoney(customs.duty)}`,
      `<i>Применён минимальный платёж за объём двигателя, поскольку он больше суммы по единой процентной ставке.</i>`,
      `<i>Курс евро ЦБ РФ: ${euroRate.toFixed(4)} ₽</i>`
    );
  } else {
    lines.push(`<b>Таможенный платёж по единой ставке ${customs.percent}%:</b> ${formatMoney(customs.duty)}`);
    if (customs.percent !== 48) {
      lines.push(`<i>Для указанной таможенной стоимости применяется ставка ${customs.percent}%, поэтому ставка 48% не используется.</i>`);
    }
  }

  lines.push(
    `<b>Таможенный сбор за операции:</b> ${formatMoney(customsFee)}`,
    ''
  );

  for (const item of util) {
    appendCustomsUtilSummary(lines, item, customs.duty + customsFee);
  }

  lines.push(CUSTOMS_EXPENSES_NOTE);
  return lines.join('\n');
}

function electricCustomsResultKeyboard(rowIndex, requestedWeight) {
  return customsResultKeyboard([{
    text: '← Исправить стоимость',
    callback_data: `customs:electric:edit:${rowIndex}:${requestedWeight || 0}`
  }]);
}

async function sendCustomsIntro(env, chatId) {
  await cleanupTemporaryMessages(env, chatId, chatId);
  await clearCustomsState(env, chatId);
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: customsIntroText(),
    parse_mode: 'HTML',
    reply_markup: customsIntroKeyboard()
  });
  await trackTemporaryMessage(env, chatId, sent.message_id);
  return sent;
}

async function showCustomsIntro(env, message) {
  await cleanupCustomsMessages(env, message.chat.id, message.chat.id, message.message_id);
  await cleanupTemporaryMessages(env, message.chat.id, message.chat.id, message.message_id);
  const edited = await telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: customsIntroText(),
    parse_mode: 'HTML',
    reply_markup: customsIntroKeyboard()
  });
  await trackTemporaryMessage(env, message.chat.id, message.message_id);
  return edited;
}

async function editCustomsScreen(env, message, text, rows, back = 'customs:start') {
  const edited = await telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text,
    parse_mode: 'HTML',
    reply_markup: customsKeyboard(rows, back)
  });
  await trackTemporaryMessage(env, message.chat.id, message.message_id);
  return edited;
}

async function sendCustomsPrompt(env, chatId, lines, placeholder, state = null) {
  const previous = await getCustomsState(env, chatId);
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: placeholder }
  });
  if (state) {
    await setCustomsState(env, chatId, {
      ...previous,
      ...state,
      cleanupMessageIds: mergeCustomsMessageIds(
        previous?.cleanupMessageIds,
        state.cleanupMessageIds,
        sent.message_id
      )
    });
  }
  return sent;
}

async function sendCustomsNotice(env, chatId, text) {
  const sent = await telegram(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
  const state = await getCustomsState(env, chatId);
  if (state) await trackCustomsMessages(env, chatId, state, sent.message_id);
  return sent;
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
  if (vehicle.hybridType && vehicle.hybridType !== 'combustion') {
    lines.push(`<b>Тип гибрида:</b> ${escapeHtml(hybridTypeLabel(vehicle.hybridType))}`);
  }
  lines.push('', `<b>Объём двигателя:</b> ${vehicle.ccm ? `${vehicle.ccm} см³` : 'не используется'}`);
  if (vehicle.engineKw || vehicle.combustionKw) {
    lines.push(`<b>Мощность ДВС:</b> ${vehicle.engineKw || vehicle.combustionKw} кВт`);
  }
  if (['series', 'ev'].includes(vehicle.hybridType) && (vehicle.engineKw || vehicle.combustionKw)) {
    lines.push('Мощность ДВС в расчёте не учитывается');
  }
  if (vehicle.electric30MinKw) {
    const electricParts = vehicle.electric30MinKwList || vehicle.electricKw || [];
    const electricDetails = electricParts.length > 1
      ? `${electricParts.join(' + ')} = ${vehicle.electric30MinKw}`
      : String(vehicle.electric30MinKw);
    lines.push(`<b>30-минутная мощность электромотора:</b> ${electricDetails} кВт`);
  }
  if (['parallel', 'parallel-series', 'series-parallel'].includes(vehicle.hybridType)) {
    lines.push(`<b>Расчётная мощность:</b> ${vehicle.engineKw || vehicle.combustionKw} + ${vehicle.electric30MinKw} = ${vehicle.totalKw} кВт`);
  } else {
    lines.push(`<b>Расчётная мощность:</b> ${vehicle.totalKw} кВт`);
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

async function sendDocumentIdentity(env, chatId, vehicle, replyToMessageId = null) {
  if (!vehicle.vin && !vehicle.surname) return null;
  const identity = `${vehicle.vin || 'VIN не найден'} / ${vehicle.surname || 'фамилия не найдена'}`;
  return telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: `<tg-spoiler>${escapeHtml(identity)}</tg-spoiler>`,
    parse_mode: 'HTML',
    reply_parameters: replyToMessageId ? {
      message_id: replyToMessageId,
      allow_sending_without_reply: true
    } : undefined
  });
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
    source: vehicle.type === 'sbkts' ? 'СБКТС' : vehicle.type === 'catalog' ? 'Шаблон СЭП' : 'ЭПТС',
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

function customsApplicationFromVehicle(vehicle, util, customs) {
  const totals = util.map(item => {
    const utilAmount = item.personal !== item.commercial ? item.personal : item.commercial;
    return customs.customsPayments + customs.customsFee + utilAmount;
  });
  return {
    ...applicationFromVehicle(vehicle, util),
    source: 'Таможенный расчёт',
    calculationType: 'customs',
    customsValue: customs.customsValue || null,
    customsDuty: customs.customsPayments,
    customsFee: customs.customsFee,
    utilAmount: util.length === 1
      ? (util[0].personal !== util[0].commercial ? util[0].personal : util[0].commercial)
      : null,
    amount: totals.length === 1 ? totals[0] : null,
    amountLabel: totals.length > 1 ? totals.map(formatMoney).join(' / ') : ''
  };
}

function applicationsStub(env, userId) {
  if (!env.APPLICATIONS || !userId) return null;
  return env.APPLICATIONS.getByName(String(userId));
}

async function getCustomsState(env, userId) {
  const stub = applicationsStub(env, userId);
  return stub ? stub.getCustomsState() : null;
}

async function setCustomsState(env, userId, state) {
  const stub = applicationsStub(env, userId);
  if (stub) await stub.setCustomsState(state);
}

async function clearCustomsState(env, userId) {
  const stub = applicationsStub(env, userId);
  if (stub) await stub.clearCustomsState();
}

async function getMessageFlowState(env, userId) {
  const stub = applicationsStub(env, userId);
  return stub ? stub.getMessageFlowState() : null;
}

async function setMessageFlowState(env, userId, state) {
  const stub = applicationsStub(env, userId);
  if (stub) await stub.setMessageFlowState(state);
}

async function clearMessageFlowState(env, userId) {
  const stub = applicationsStub(env, userId);
  if (stub) await stub.clearMessageFlowState();
}

function mergeTemporaryMessageIds(current, ...messageIds) {
  return [...new Set([
    ...(Array.isArray(current) ? current : []),
    ...messageIds.flat().filter(id => Number.isInteger(id) && id > 0)
  ])].slice(-20);
}

async function trackTemporaryMessage(env, userId, ...messageIds) {
  const current = await getMessageFlowState(env, userId);
  await setMessageFlowState(env, userId, {
    temporaryMessageIds: mergeTemporaryMessageIds(current?.temporaryMessageIds, messageIds)
  });
}

async function releaseTemporaryMessage(env, userId, messageId) {
  const current = await getMessageFlowState(env, userId);
  const temporaryMessageIds = mergeTemporaryMessageIds(current?.temporaryMessageIds)
    .filter(id => id !== messageId);
  if (temporaryMessageIds.length) await setMessageFlowState(env, userId, { temporaryMessageIds });
  else await clearMessageFlowState(env, userId);
}

async function deleteBotMessage(env, chatId, messageId, label = 'Temporary message cleanup') {
  if (!Number.isInteger(messageId) || messageId <= 0) return;
  try {
    await telegram(env, 'deleteMessage', { chat_id: chatId, message_id: messageId });
  } catch (error) {
    console.warn(label + ':', error.message || error);
  }
}

async function discardWorkingCard(env, message, userId = message?.chat?.id) {
  if (!message?.from?.is_bot) return;
  await releaseTemporaryMessage(env, userId, message.message_id);
}

async function cleanupTemporaryMessages(env, userId, chatId, exceptMessageId = null) {
  // Рабочие карточки остаются в истории: очищаем только служебную привязку
  // к текущему сценарию, а не сообщения пользователя или бота.
  if (exceptMessageId) await setMessageFlowState(env, userId, { temporaryMessageIds: [exceptMessageId] });
  else await clearMessageFlowState(env, userId);
}

function mergeCustomsMessageIds(current, ...messageIds) {
  return [...new Set([
    ...(Array.isArray(current) ? current : []),
    ...messageIds.flat().filter(id => Number.isInteger(id) && id > 0)
  ])].slice(-50);
}

async function trackCustomsMessages(env, userId, state, ...messageIds) {
  await setCustomsState(env, userId, {
    ...state,
    cleanupMessageIds: mergeCustomsMessageIds(state?.cleanupMessageIds, messageIds)
  });
}

async function cleanupCustomsMessages(env, userId, chatId, exceptMessageId = null) {
  // Подтверждения и шаги таможенного расчёта — часть истории расчёта.
  // При переходе сбрасываем только состояние сценария.
  await clearCustomsState(env, userId);
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

function calculationResultKeyboard(cases = [], deadline = null) {
  const rows = [];
  if (deadline) rows.push([{ text: '📅 Рассчитать пени на другую дату', callback_data: encodePeniCallback(cases, deadline) }]);
  rows.push([
    { text: '🔄 Новый расчёт', callback_data: 'calc:result:new' },
    { text: '🏠 Главное меню', callback_data: 'calc:result:menu' }
  ]);
  return { inline_keyboard: rows };
}

function calculationWorkKeyboard() {
  return {
    inline_keyboard: [[
      { text: '🔄 Новый расчёт', callback_data: 'calc:new' },
      { text: '🏠 Главное меню', callback_data: 'calc:menu' }
    ]]
  };
}

function documentErrorKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📎 Загрузить документ заново', callback_data: 'calc:retry:document' }],
      [
        { text: '⬅️ Назад', callback_data: 'calc:back:document' },
        { text: '🏠 Главное меню', callback_data: 'calc:menu' }
      ]
    ]
  };
}

function documentUploadKeyboard() {
  return {
    inline_keyboard: [[
      { text: '⬅️ Назад', callback_data: 'calc:back:document' },
      { text: '🏠 Главное меню', callback_data: 'calc:menu' }
    ]]
  };
}

function controlledDocumentError(error) {
  if (error instanceof DocumentProcessingError) return error;
  return new DocumentProcessingError('CALCULATION_ERROR', error?.message || String(error), error);
}

function documentErrorText(error) {
  const controlled = controlledDocumentError(error);
  return `Не удалось обработать документ: ${escapeHtml(controlled.message)}.`;
}

async function sendIssueDatePrompt(env, chatId, cases, notice = '') {
  await cleanupTemporaryMessages(env, chatId, chatId);
  const lines = [];
  if (notice) lines.push(`<b>${escapeHtml(notice)}</b>`, '');
  lines.push(
    'Чтобы рассчитать пени, нужна дата оформления СБКТС.',
    'Введите её ответом на это сообщение в любом привычном формате.',
    '',
    encodeCases(cases),
    '',
    '<i>Например: 02.09.2026 или 2 сентября 2026</i>'
  );
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Дата оформления СБКТС' }
  });
  await trackTemporaryMessage(env, chatId, sent.message_id);
  return sent;
}

async function sendPlannedDatePrompt(env, chatId, cases, deadline, notice = '') {
  await cleanupTemporaryMessages(env, chatId, chatId);
  const lines = [];
  if (notice) lines.push(`<b>${escapeHtml(notice)}</b>`, '');
  lines.push(
    'Планируете подать документы позже?',
    'Введите предполагаемую дату ответом на это сообщение — я пересчитаю пени точно на этот день.',
    '',
    `Крайний срок: ${formatDate(deadline)}`,
    encodeCases(cases)
  );
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Предполагаемая дата подачи' }
  });
  await trackTemporaryMessage(env, chatId, sent.message_id);
  return sent;
}

async function handleDateReply(env, message) {
  const prompt = message.reply_to_message?.text || '';
  const date = parseFlexibleDate(message.text);
  const issueDatePrompt = prompt.includes('Чтобы рассчитать пени');
  const plannedDatePrompt = prompt.includes('Планируете подать документы позже');
  if (!prompt || (!issueDatePrompt && !plannedDatePrompt)) return false;
  const cases = extractCases(prompt);
  if (!date || !cases.length) {
    if (issueDatePrompt) {
      await sendIssueDatePrompt(env, message.chat.id, cases, 'Не удалось распознать дату. Попробуйте ещё раз.');
    }
    else {
      const deadline = parseDateFromPrompt(prompt, 'Крайний срок');
      if (deadline) await sendPlannedDatePrompt(env, message.chat.id, cases, deadline, 'Не удалось распознать дату. Попробуйте ещё раз.');
    }
    return true;
  }
  await cleanupTemporaryMessages(env, message.from?.id || message.chat.id, message.chat.id);
  if (issueDatePrompt) {
    const deadline = addWorkingDays(date, 5);
    await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: [`<b>Крайний срок уплаты: ${formatDate(deadline)}</b>`, formatPeniCompact(cases, deadline, todayUtc())].join('\n'),
      parse_mode: 'HTML',
      reply_markup: calculationResultKeyboard(cases, deadline)
    });
  } else {
    const d…13558 tokens truncated…tons = CATALOG_CCM_BUCKETS.map(bucket => ({
    text: bucket.label,
    callback_data: 'catalog:calc:' + rowIndex + ':' + bucket.value + ':' + weight
  }));
  return {
    inline_keyboard: [
      buttons.slice(0, 2),
      buttons.slice(2, 4),
      [buttons[4], { text: '⚡ Электро/гибрид', callback_data: 'catalog:calc:' + rowIndex + ':e:' + weight }],
      [
        { text: '← Назад', callback_data: backCallback },
        { text: '🏠 Главное меню', callback_data: 'calc:menu' }
      ]
    ]
  };
}

function catalogEnginePrompt(candidate, weight, sourceParsed) {
  const instruction = sourceParsed?.customsMode === 'passenger' && sourceParsed.customsCcm
    ? 'Объём двигателя уже указан. Продолжите расчёт утильсбора.'
    : 'Выберите тип автомобиля и группу объёма двигателя.';
  const lines = [
    '✅ <b>Автомобиль найден в шаблоне СЭП</b>',
    '',
    catalogCandidateDescription(candidate, weight),
    '',
    instruction,
    ''
  ];
  if (!(sourceParsed?.customsMode === 'passenger' && sourceParsed.customsCcm)) {
    lines.push('<i>Для электромобиля или последовательного гибрида выберите «Электро/гибрид»: в расчёт пойдёт только 30-минутная мощность.</i>', '');
  }
  lines.push(catalogNavigationLine(sourceParsed));
  return lines.join('\n');
}

function catalogNoPreferenceReason(ccm, kw) {
  if (!ccm) return 'мощность выше 58,84 кВт (80 л.с.)';
  if (ccm > 3000) return 'объём двигателя превышает 3000 см³';
  return 'мощность выше 117,68 кВт (160 л.с.)';
}

function formatCatalogResult(candidate, vehicle, util, customs = null) {
  const electric = !vehicle.ccm;
  const lines = [
    '✅ <b>Расчёт утильсбора</b>',
    '',
    '<b>Автомобиль:</b> ' + escapeHtml([candidate.brand, candidate.model].filter(Boolean).join(' ')),
    '<b>Год выпуска:</b> ' + candidate.year,
    '<b>Технически допустимая масса:</b> ' + (vehicle.maxMass || candidate.mass || '—') + (vehicle.maxMass || candidate.mass ? ' кг' : ''),
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
  if (!customs?.customsPayments) {
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
  }
  if (customs?.customsPayments) {
    lines.push('<b>Таможенный расчёт:</b>');
    if (customs.enteredValue && customs.currency && customs.currencyRate) {
      lines.push(...customsValueLines(customs.enteredValue, customs.currency, customs.currencyRate, customs.customsValue));
    } else if (customs.customsValue) {
      lines.push('Таможенная стоимость: ' + formatMoney(customs.customsValue));
    }
    if (customs.customsFeeRange) lines.push('Выбранный диапазон: ' + customs.customsFeeRange);
    lines.push('Таможенная пошлина: ' + formatMoney(customs.customsPayments));
    if (customs.euroRate) lines.push('Курс евро ЦБ РФ: ' + Number(customs.euroRate).toFixed(4) + ' ₽');
    lines.push('Таможенный сбор за операции: ' + formatMoney(customs.customsFee));
    lines.push('');
    for (const item of util) {
      appendCustomsUtilSummary(lines, item, customs.customsPayments + customs.customsFee);
    }
    lines.push(CUSTOMS_EXPENSES_NOTE);
  }
  return lines.join('\n').trim();
}

async function showCatalogCandidate(env, message, rowIndex, weight, sourceParsed = null, backCallback = null) {
  const catalog = await loadCatalog(env.CATALOG_URL);
  const candidate = getCatalogCandidate(catalog, rowIndex);
  if (!candidate) throw new Error('Выбранная версия автомобиля больше не найдена в шаблоне СЭП');
  const source = sourceParsed || parseCatalogQuery(candidate.brand + ' ' + candidate.model + ' ' + candidate.year);
  const back = backCallback || 'catalog:back:variants:' + candidate.rowIndex;
  if (source?.customsMode === 'under3') {
    if (!candidate.combustionKw && candidate.electricKw) {
      return showUnder3ElectricRedirect(env, message, candidate, weight, back, source);
    }
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: [
        '✅ <b>Автомобиль найден в шаблоне СЭП</b>',
        '',
        catalogCandidateDescription(candidate, weight),
        '',
        'Продолжите расчёт, если выбран правильный автомобиль.',
        '',
        catalogNavigationLine(source)
      ].join('\n'),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{
            text: 'Продолжить расчёт',
            callback_data: `customs:under3:volume:${candidate.rowIndex}:${weight || candidate.mass || 0}`
          }],
          [
            { text: '← Назад', callback_data: back },
            { text: '🏠 Главное меню', callback_data: 'calc:menu' }
          ]
        ]
      }
    });
    return;
  }
  if (source?.customsMode === 'electric') {
    electricCustomsPowerDetails(candidate);
    return showElectricCustomsCurrencyPrompt(env, message, candidate, weight, back, source);
  }
  await telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: catalogEnginePrompt(candidate, weight, source),
    parse_mode: 'HTML',
    reply_markup: catalogEngineKeyboard(candidate.rowIndex, weight, back, source)
  });
}

async function showCatalogModification(env, message, brandIndex, modelIndex, year, sourceParsed = null, page = 0, modificationsPage = 0) {
  const catalog = await loadCatalog(env.CATALOG_URL);
  const variants = getCatalogVariants(catalog, brandIndex, modelIndex, year);
  if (!variants.length) throw new Error('Варианты выбранной модификации не найдены');

  const first = variants[0];
  const parsed = parseCatalogQuery(first.brand + ' ' + first.model + ' ' + first.year);
  const source = sourceParsed || parsed;
  const pagination = paginateCatalogVariants(variants, page);
  if (!pagination.total) {
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: [
        '<b>' + escapeHtml(first.brand + ' ' + first.model) + ' ' + first.year + '</b>',
        '',
        'В шаблоне СЭП пока нет готового варианта одновременно с мощностью и точной технически допустимой массой.',
        'Уточните модификацию автомобиля или вернитесь к новому поиску.',
        '',
        catalogNavigationLine(source)
      ].join('\n'),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '← Назад', callback_data: `catalog:mods:${modificationsPage}` },
          { text: '🏠 Главное меню', callback_data: 'calc:menu' }
        ]]
      }
    });
    return;
  }

  await telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: [
      '<b>' + escapeHtml(first.brand + ' ' + first.model) + ' ' + first.year + '</b>',
      '',
      'Выберите мощность и технически допустимую максимальную массу по шильдику автомобиля:',
      pagination.pageCount > 1
        ? `Показаны варианты ${pagination.currentPage * 8 + 1}–${pagination.currentPage * 8 + pagination.items.length} из ${pagination.total}.`
        : '',
      '',
      catalogNavigationLine(source)
    ].filter(Boolean).join('\n'),
    parse_mode: 'HTML',
    reply_markup: catalogPowerMassKeyboard(variants, brandIndex, modelIndex, year, pagination.currentPage, modificationsPage)
  });
}

async function sendCatalogWeightPrompt(env, chatId, parsed) {
  await cleanupTemporaryMessages(env, chatId, chatId);
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: [
      'Чтобы найти точную модификацию и мощность, укажите <b>технически допустимую максимальную массу</b> автомобиля в килограммах.',
      '',
      '<b>Марка и модель:</b> ' + escapeHtml(parsed.vehicleText),
      '<b>Год выпуска:</b> ' + parsed.year,
      '',
      catalogNavigationLine(parsed),
      '',
      'Ответьте на это сообщение только числом.'
    ].join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: 'Масса автомобиля, кг'
    }
  });
  await trackTemporaryMessage(env, chatId, sent.message_id);
  return sent;
}

function catalogQueryFromWeightPrompt(prompt) {
  const vehicle = prompt.match(/Марка и модель:\s*(.+)/i)?.[1]?.trim();
  const year = prompt.match(/Год выпуска:\s*((?:19|20)\d{2})/i)?.[1];
  const parsed = vehicle && year ? parseCatalogQuery(vehicle + ' ' + year) : null;
  return parsed;
}

async function runCatalogSearch(env, message, parsed, weight) {
  const userId = message.from?.id || message.chat.id;
  await cleanupTemporaryMessages(env, userId, message.chat.id);
  await telegram(env, 'sendChatAction', { chat_id: message.chat.id, action: 'typing' });
  const status = await telegram(env, 'sendMessage', {
    chat_id: message.chat.id,
    text: '🔎 Ищу автомобиль в шаблоне СЭП с учётом массы…'
  });
  await trackTemporaryMessage(env, userId, status.message_id);

  try {
    const catalog = await loadCatalog(env.CATALOG_URL);
    const matches = searchCatalog(catalog, parsed, weight);
    if (!matches.length) {
      await telegram(env, 'editMessageText', {
        chat_id: message.chat.id,
        message_id: status.message_id,
        text: [
          'Не нашёл подходящую модификацию для указанной массы <b>' + weight + ' кг</b>.',
          '',
          'Проверьте марку, модель, год выпуска и массу, затем начните поиск заново.'
        ].join('\n'),
        parse_mode: 'HTML',
        reply_markup: calculationWorkKeyboard()
      });
      return;
    }

    if (matches.length === 1) {
      await showCatalogCandidate(env, status, matches[0].rowIndex, weight, parsed, 'catalog:back:weight');
      return;
    }

    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: status.message_id,
      text: [
        'Нашёл несколько вариантов для массы <b>' + weight + ' кг</b>. Выберите подходящую мощность:',
        '',
        catalogNavigationLine(parsed)
      ].join('\n'),
      parse_mode: 'HTML',
      reply_markup: catalogVariantsKeyboard(matches, weight)
    });
  } catch (error) {
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: status.message_id,
      text: 'Не удалось выполнить поиск: ' + escapeHtml(error.message || error) + '. Попробуйте ещё раз немного позже.',
      parse_mode: 'HTML'
    });
  }
}

async function handleCatalogWeightReply(env, message) {
  const prompt = message.reply_to_message?.text || '';
  if (!prompt.startsWith('Чтобы найти точную модификацию и мощность')) return false;
  const state = await getCustomsState(env, message.from?.id || message.chat.id);
  const parsed = withCustomsState(catalogQueryFromWeightPrompt(prompt), state);
  const weight = parseCatalogWeight(message.text);
  if (!parsed || !weight) {
    await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: 'Не удалось распознать массу. Укажите технически допустимую максимальную массу одним числом в килограммах.'
    });
    if (parsed) await sendCatalogWeightPrompt(env, message.chat.id, parsed);
    return true;
  }
  await runCatalogSearch(env, message, parsed, weight);
  return true;
}

async function runCatalogTextSearch(env, message, parsed) {
  const userId = message.from?.id || message.chat.id;
  await cleanupTemporaryMessages(env, userId, message.chat.id);
  await telegram(env, 'sendChatAction', { chat_id: message.chat.id, action: 'typing' });
  const status = await telegram(env, 'sendMessage', {
    chat_id: message.chat.id,
    text: '🔎 Ищу автомобиль в шаблоне СЭП…'
  });
  await trackTemporaryMessage(env, userId, status.message_id);
  try {
    const catalog = await loadCatalog(env.CATALOG_URL);
    const modifications = listCatalogModifications(catalog, parsed);
    if (!modifications.length) {
      const suggestions = listCatalogSuggestions(catalog, parsed);
      if (suggestions.length) {
        if (suggestions.length > 25) {
          await telegram(env, 'editMessageText', {
            chat_id: message.chat.id,
            message_id: status.message_id,
            text: [
              'Найдено слишком много похожих вариантов.',
              '',
              'Уточните модель, модификацию или год выпуска и повторите запрос.'
            ].join('\n'),
            reply_markup: calculationWorkKeyboard()
          });
          return true;
        }
        await telegram(env, 'editMessageText', {
          chat_id: message.chat.id,
          message_id: status.message_id,
          text: catalogSuggestionsText(suggestions, parsed),
          parse_mode: 'HTML',
          reply_markup: catalogSuggestionsKeyboard(suggestions)
        });
        return true;
      }
      await telegram(env, 'editMessageText', {
        chat_id: message.chat.id,
        message_id: status.message_id,
        text: 'Не нашёл автомобиль в шаблоне СЭП. Проверьте марку, модель и год выпуска.',
        reply_markup: calculationWorkKeyboard()
      });
      return true;
    }
    if (modifications.length > 25) {
      await telegram(env, 'editMessageText', {
        chat_id: message.chat.id,
        message_id: status.message_id,
        text: [
          'Найдено слишком много модификаций — <b>' + modifications.length + '</b>.',
          '',
          'Уточните полное название модификации автомобиля и повторите запрос.'
        ].join('\n'),
        parse_mode: 'HTML',
        reply_markup: calculationWorkKeyboard()
      });
      return true;
    }
    if (modifications.length > 1) {
      await telegram(env, 'editMessageText', {
        chat_id: message.chat.id,
        message_id: status.message_id,
        text: catalogModificationsText(modifications, parsed, 0),
        parse_mode: 'HTML',
        reply_markup: catalogModificationKeyboard(modifications, 0)
      });
      return true;
    }
    const selected = modifications[0];
    await showCatalogModification(env, status, selected.brandIndex, selected.modelIndex, selected.year, parsed);
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

async function handleCatalogText(env, message) {
  if (message.chat?.type !== 'private' || message.text.startsWith('/')) return false;
  const parsed = parseCatalogQuery(message.text);
  if (!parsed) return false;
  return runCatalogTextSearch(env, message, parsed);
}

async function showCatalogModificationsPage(env, message, sourceParsed, page = 0) {
  if (!sourceParsed) throw new Error('Не удалось восстановить исходный запрос');
  const catalog = await loadCatalog(env.CATALOG_URL);
  const modifications = listCatalogModifications(catalog, sourceParsed);
  if (!modifications.length || modifications.length > 25) {
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: catalogSearchPrompt(),
      parse_mode: 'HTML',
      reply_markup: catalogSearchKeyboard()
    });
    return;
  }
  const pagination = paginateCatalogModifications(modifications, page);
  await telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: catalogModificationsText(modifications, sourceParsed, pagination.currentPage),
    parse_mode: 'HTML',
    reply_markup: catalogModificationKeyboard(modifications, pagination.currentPage)
  });
}

async function handleCatalogCallback(env, query) {
  const message = query.message;
  const state = await getCustomsState(env, query.from?.id || message.chat.id);
  const sourceParsed = withCustomsState(catalogQueryFromNavigationMessage(message), state);
  if (query.data === 'catalog:noop') return;
  if (query.data === 'catalog:back:search') {
    if (sourceParsed?.customsMode) {
      const userId = query.from?.id || message.chat.id;
      if (sourceParsed.customsMode === 'under3') {
        await cleanupCustomsMessages(env, userId, message.chat.id);
        await discardWorkingCard(env, message, userId);
        await sendUnder3CatalogPrompt(env, message.chat.id, userId);
        return;
      }
      await sendCustomsCatalogPrompt(
        env,
        message.chat.id,
        sourceParsed.customsDuty,
        sourceParsed.customsMode,
        sourceParsed.customsCcm,
        sourceParsed.customsValue,
        sourceParsed.customsFee,
        sourceParsed.customsEnteredValue,
        sourceParsed.customsCurrency,
        sourceParsed.customsCurrencyRate,
        sourceParsed.customsEuroRate,
        sourceParsed.customsFeeRange
      );
      return;
    }
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: catalogSearchPrompt(),
      parse_mode: 'HTML',
      reply_markup: catalogSearchKeyboard()
    });
    return;
  }
  if (query.data === 'catalog:back:mods') {
    await showCatalogModificationsPage(env, message, sourceParsed, 0);
    return;
  }
  const modificationsPage = query.data.match(/^catalog:mods:(\d+)$/);
  if (modificationsPage) {
    await showCatalogModificationsPage(env, message, sourceParsed, Number(modificationsPage[1]));
    return;
  }
  if (query.data === 'catalog:back:weight') {
    if (!sourceParsed) throw new Error('Не удалось восстановить запрос для выбора массы');
    await sendCatalogWeightPrompt(env, message.chat.id, sourceParsed);
    return;
  }
  const variantsBack = query.data.match(/^catalog:back:variants:(\d+)$/);
  if (variantsBack) {
    const catalog = await loadCatalog(env.CATALOG_URL);
    const candidate = getCatalogCandidate(catalog, Number(variantsBack[1]));
    if (!candidate) throw new Error('Автомобиль больше не найден в шаблоне СЭП');
    await showCatalogModification(
      env,
      message,
      candidate.brandIndex,
      candidate.modelIndex,
      candidate.year,
      sourceParsed
    );
    return;
  }
  const model = query.data.match(/^catalog:model:(\d+):(\d+):(\d{4})(?::(\d+))?$/);
  if (model) {
    await showCatalogModification(
      env,
      message,
      Number(model[1]),
      Number(model[2]),
      Number(model[3]),
      sourceParsed,
      0,
      Number(model[4]) || 0
    );
    return;
  }
  const variantsPage = query.data.match(/^catalog:variants:(\d+):(\d+):(\d{4}):(\d+)(?::(\d+))?$/);
  if (variantsPage) {
    await showCatalogModification(
      env,
      message,
      Number(variantsPage[1]),
      Number(variantsPage[2]),
      Number(variantsPage[3]),
      sourceParsed,
      Number(variantsPage[4]),
      Number(variantsPage[5]) || 0
    );
    return;
  }
  const pick = query.data.match(/^catalog:pick:(\d+)(?::(\d+))?(?::(\d+))?(?::(\d+))?$/);
  if (pick) {
    const catalog = await loadCatalog(env.CATALOG_URL);
    const candidate = getCatalogCandidate(catalog, Number(pick[1]));
    if (!candidate) throw new Error('Автомобиль больше не найден в шаблоне СЭП');
    const backCallback = message.text?.startsWith('Нашёл несколько вариантов для массы')
      ? 'catalog:back:weight'
      : `catalog:variants:${candidate.brandIndex}:${candidate.modelIndex}:${candidate.year}:${Number(pick[3]) || 0}:${Number(pick[4]) || 0}`;
    await showCatalogCandidate(
      env,
      message,
      Number(pick[1]),
      Number(pick[2]) || null,
      sourceParsed,
      backCallback
    );
    return;
  }

  const calculation = query.data.match(/^catalog:calc:(\d+):(e|\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/);
  if (!calculation) return;
  const catalog = await loadCatalog(env.CATALOG_URL);
  const candidate = getCatalogCandidate(catalog, Number(calculation[1]));
  if (!candidate) throw new Error('Автомобиль больше не найден в шаблоне СЭП');

  const electric = calculation[2] === 'e';
  const ccm = electric ? null : Number(calculation[2]);
  const requestedWeight = Number(calculation[3]) || candidate.mass || null;
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
    maxMass: requestedWeight,
    issueDate: null,
    hybridType: electric ? 'электромобиль / последовательный гибрид' : 'ДВС / параллельный гибрид'
  };
  const util = calculateUtil(vehicle);
  if (sourceParsed?.customsMode === 'electric') {
    await showElectricCustomsCurrencyPrompt(
      env,
      message,
      candidate,
      requestedWeight,
      `catalog:back:variants:${candidate.rowIndex}`,
      sourceParsed
    );
    return;
  }
  const customs = sourceParsed?.customsDuty ? {
    customsValue: Number(sourceParsed.customsValue) || null,
    customsPayments: Number(sourceParsed.customsDuty),
    customsFee: Number(sourceParsed.customsFee) || (sourceParsed.customsValue
      ? calculateCustomsProcessingFee(sourceParsed.customsValue)
      : 0),
    customsFeeRange: sourceParsed.customsFeeRange || null,
    enteredValue: Number(sourceParsed.customsEnteredValue) || null,
    currency: electricCustomsCurrency(sourceParsed.customsCurrency),
    currencyRate: sourceParsed.customsCurrencyRate || null,
    euroRate: Number(sourceParsed.customsEuroRate) || null
  } : null;
  await saveApplication(
    env,
    query.from?.id,
    customs ? customsApplicationFromVehicle(vehicle, util, customs) : applicationFromVehicle(vehicle, util)
  );
  await telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: formatCatalogResult(candidate, vehicle, util, customs),
    parse_mode: 'HTML',
    reply_markup: customs ? customsResultKeyboard() : calculationResultKeyboard()
  });
  await releaseTemporaryMessage(env, query.from?.id || message.chat.id, message.message_id);
  if (customs) await clearCustomsState(env, query.from?.id || message.chat.id);
}

async function handleDocument(env, message) {
  const document = message.document;
  const isPdf = document.mime_type === 'application/pdf' || /\.pdf$/i.test(document.file_name || '');
  if (!isPdf) {
    const userId = message.from?.id || message.chat.id;
    await cleanupTemporaryMessages(env, userId, message.chat.id);
    const sent = await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: 'Пожалуйста, отправьте документ в формате PDF.',
      reply_markup: documentErrorKeyboard()
    });
    await trackTemporaryMessage(env, userId, sent.message_id);
    return;
  }
  if (document.file_size > 20 * 1024 * 1024) {
    const userId = message.from?.id || message.chat.id;
    await cleanupTemporaryMessages(env, userId, message.chat.id);
    const sent = await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: 'Файл больше 20 МБ. Telegram не позволяет боту скачать такой документ.',
      reply_markup: documentErrorKeyboard()
    });
    await trackTemporaryMessage(env, userId, sent.message_id);
    return;
  }
  const userId = message.from?.id || message.chat.id;
  await cleanupTemporaryMessages(env, userId, message.chat.id);
  await telegram(env, 'sendChatAction', { chat_id: message.chat.id, action: 'typing' });
  const status = await telegram(env, 'sendMessage', { chat_id: message.chat.id, text: '📄 Читаю документ и рассчитываю утильсбор…' });
  await trackTemporaryMessage(env, userId, status.message_id);
  try {
    const file = await telegram(env, 'getFile', { file_id: document.file_id });
    const response = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`);
    if (!response.ok) throw new Error('Telegram не отдал файл для скачивания');
    const { vehicle, util, deadline } = await processVehicleDocument(new Uint8Array(await response.arrayBuffer()));
    const cases = peniCases(util);
    const result = formatDocumentResult(vehicle, util, deadline);
    await saveApplication(env, message.from?.id, applicationFromVehicle(vehicle, util));
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: status.message_id,
      text: result,
      parse_mode: 'HTML',
      reply_markup: calculationResultKeyboard(cases, deadline)
    });
    await sendDocumentIdentity(env, message.chat.id, vehicle, message.message_id).catch(() => null);
    await releaseTemporaryMessage(env, userId, status.message_id);
    if (!vehicle.issueDate) await sendIssueDatePrompt(env, message.chat.id, cases);
  } catch (error) {
    const controlled = controlledDocumentError(error);
    console.error('document_processing_error', JSON.stringify({
      documentType: 'sbkts-or-epts',
      code: controlled.code,
      message: controlled.message
    }));
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: status.message_id,
      text: documentErrorText(controlled),
      parse_mode: 'HTML',
      reply_markup: documentErrorKeyboard()
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
    const { vehicle, util, deadline } = await processVehicleDocument(new Uint8Array(await response.arrayBuffer()));
    await saveApplication(env, query.from?.id, applicationFromVehicle(vehicle, util));
    await telegram(env, 'editMessageText', {
      chat_id: botMessage.chat.id,
      message_id: botMessage.message_id,
      text: formatDocumentResult(vehicle, util, deadline),
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] }
    });
    await sendDocumentIdentity(env, botMessage.chat.id, vehicle, sourceMessage.message_id).catch(() => null);
  } catch (error) {
    const controlled = controlledDocumentError(error);
    console.error('group_document_processing_error', JSON.stringify({
      documentType: 'sbkts-or-epts',
      code: controlled.code,
      message: controlled.message
    }));
    await telegram(env, 'editMessageText', {
      chat_id: botMessage.chat.id,
      message_id: botMessage.message_id,
      text: documentErrorText(controlled),
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] }
    });
  }
}

async function sendMenu(env, chatId, text = MENU_TEXT) {
  await cleanupCustomsMessages(env, chatId, chatId);
  await cleanupTemporaryMessages(env, chatId, chatId);
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: menuKeyboard(env)
  });
  await trackTemporaryMessage(env, chatId, sent.message_id);
  return sent;
}

async function editMenu(env, message) {
  await cleanupCustomsMessages(env, message.chat.id, message.chat.id, message.message_id);
  await cleanupTemporaryMessages(env, message.chat.id, message.chat.id, message.message_id);
  const edited = await telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: MENU_TEXT,
    parse_mode: 'HTML',
    reply_markup: menuKeyboard(env)
  });
  await trackTemporaryMessage(env, message.chat.id, message.message_id);
  return edited;
}

async function showInfo(env, message, section) {
  const info = INFO[section];
  if (!info) return;
  const text = typeof info.text === 'function' ? info.text(env) : info.text;
  const edited = await telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: `${info.title}\n\n${text}`,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: infoKeyboard(section, env)
  });
  await trackTemporaryMessage(env, message.chat.id, message.message_id);
  return edited;
}

async function sendCalculationStart(env, chatId, userId = chatId) {
  await cleanupTemporaryMessages(env, userId, chatId);
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: '📎 Отправьте новый PDF-файл СБКТС или выписку ЭПТС либо напишите марку, модель и год выпуска автомобиля.',
    reply_markup: { inline_keyboard: [[{ text: '🏠 Главное меню', callback_data: 'calc:menu' }]] }
  });
  await trackTemporaryMessage(env, userId, sent.message_id);
  return sent;
}

async function handleCalculationCallback(env, query) {
  const message = query.message;
  const userId = query.from?.id || message.chat.id;
  if (query.data === 'calc:result:menu' || (query.data === 'calc:menu' && isPermanentResultText(message.text))) {
    await sendMenu(env, message.chat.id);
    return;
  }
  if (query.data === 'calc:result:new' || (query.data === 'calc:new' && isPermanentResultText(message.text))) {
    await sendCalculationStart(env, message.chat.id, userId);
    return;
  }
  if (query.data === 'calc:menu') {
    await releaseTemporaryMessage(env, userId, message.message_id);
    await sendMenu(env, message.chat.id);
    return;
  }
  if (query.data === 'calc:new') {
    await cleanupTemporaryMessages(env, userId, message.chat.id, message.message_id);
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: '📎 Отправьте новый PDF-файл СБКТС или выписку ЭПТС либо напишите марку, модель и год выпуска автомобиля.',
      reply_markup: { inline_keyboard: [[{ text: '🏠 Главное меню', callback_data: 'calc:menu' }]] }
    });
    await trackTemporaryMessage(env, userId, message.message_id);
    return;
  }
  if (query.data === 'calc:retry:document') {
    await cleanupTemporaryMessages(env, userId, message.chat.id, message.message_id);
    await telegram(env, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: 'Отправьте СБКТС или выписку ЭПТС в формате PDF.',
      reply_markup: documentUploadKeyboard()
    });
    await trackTemporaryMessage(env, userId, message.message_id);
    return;
  }
  if (query.data === 'calc:back:document') {
    await showInfo(env, message, 'pdf');
    return;
  }
  const match = query.data.match(/^calc:peni:(\d{4}-\d{2}-\d{2}):([\d,]+)$/);
  if (!match) return;
  const deadline = parseFlexibleDate(match[1]);
  const sums = match[2].split(',').map(Number).filter(Boolean);
  const labels = sums.length > 1 ? ['до 3 лет', 'старше 3 лет'] : [''];
  const cases = sums.map((sum, index) => ({ label: labels[index] || '', sum }));
  await sendPlannedDatePrompt(env, message.chat.id, cases, deadline);
}

async function handleUpdate(env, update) {
  if (update.message?.document) {
    if (isGroupChat(update.message.chat)) await offerGroupCalculation(env, update.message);
    else await handleDocument(env, update.message);
    return;
  }
  if (update.message?.text) {
    const command = update.message.text.split(/\s+/)[0].split('@')[0].toLowerCase();
    if (command === '/start') {
      await sendMenu(env, update.message.chat.id, START_MENU_TEXT);
      return;
    }
    if (command === '/menu' || command === '/help') {
      await sendMenu(env, update.message.chat.id);
      return;
    }
    if (await handleDateReply(env, update.message)) return;
    if (await handleCustomsReply(env, update.message)) return;
    if (await handleCatalogWeightReply(env, update.message)) return;
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
  else if (query.data?.startsWith('customs:')) await handleCustomsCallback(env, query);
  else if (query.data?.startsWith('calc:')) await handleCalculationCallback(env, query);
  else if (query.data === 'menu') await sendMenu(env, query.message.chat.id);
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
      if (request.method === 'GET' && url.pathname === '/api/rates/eur') {
        return new Response(JSON.stringify({ ok: true, rate: await euroRate(env) }), { headers: apiHeaders(env) });
      }
      if (request.method === 'GET' && url.pathname.startsWith('/setup/')) return setupBot(request, env);
      if (request.method === 'GET' && url.pathname === '/') {
        return Response.json({ ok: true, service: 'grani-telegram-bot', version: 'sbkts-power-parser-v19' });
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
