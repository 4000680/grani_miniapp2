import {
  calculationPower,
  getCatalogCandidate,
  getCatalogVariants,
  listCatalogModifications,
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
  parseFlexibleDate,
  parseVehicleDocument,
  readPdf,
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

const MENU_TEXT = [
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

function under3CustomsResultText(candidate, vehicle, customs, customsFee, util, euroRate) {
  const lines = [
    '✅ <b>Полный расчёт автомобиля до 3 лет</b>',
    '',
    `<b>Автомобиль:</b> ${escapeHtml(candidate.brand + ' ' + candidate.model)}`,
    `<b>Год выпуска:</b> ${candidate.year}`,
    `<b>Мощность:</b> ${vehicle.totalKw} кВт`,
    `<b>Технически допустимая масса:</b> ${vehicle.maxMass || '—'}${vehicle.maxMass ? ' кг' : ''}`,
    `<b>Объём двигателя:</b> ${vehicle.ccm} см³`,
    `<b>Таможенная стоимость:</b> ${formatMoney(customs.customsValueRub)}`,
    ''
  ];

  if (customs.selectedBy === 'minimum') {
    lines.push(
      `<b>По единой ставке ${customs.percent}%:</b> ${formatMoney(customs.percentageAmount)}`,
      `<b>Минимальный платёж ${customs.minEuroPerCc} €/см³:</b> ${formatMoney(customs.minimumAmount)}`,
      `<b>Таможенный платёж:</b> ${formatMoney(customs.duty)}`,
      `<i>Применён минимальный платёж за объём двигателя, поскольку он больше суммы по единой процентной ставке.</i>`
    );
  } else {
    lines.push(`<b>Таможенный платёж по единой ставке ${customs.percent}%:</b> ${formatMoney(customs.duty)}`);
    if (customs.percent !== 48) {
      lines.push(`<i>Для указанной таможенной стоимости применяется ставка ${customs.percent}%, поэтому ставка 48% не используется.</i>`);
    }
  }

  lines.push(
    `<b>Таможенный сбор за операции:</b> ${formatMoney(customsFee)}`,
    `<i>Курс евро ЦБ РФ: ${euroRate.toFixed(4)} ₽</i>`,
    ''
  );

  for (const item of util) {
    lines.push(`<b>Утильсбор — ${ageLabel(item.age)}:</b>`);
    if (item.personal !== item.commercial) {
      lines.push(
        `Льготный для личного пользования: <b>${formatMoney(item.personal)}</b>`,
        `Коммерческий: <b>${formatMoney(item.commercial)}</b>`,
        `<b>Итого для личного пользования: ${formatMoney(customs.duty + customsFee + item.personal)}</b>`,
        `<b>Итого по коммерческой ставке: ${formatMoney(customs.duty + customsFee + item.commercial)}</b>`
      );
    } else {
      lines.push(
        'Льготный для личного пользования: <b>не применяется</b>',
        `Коммерческий: <b>${formatMoney(item.commercial)}</b>`,
        `<b>Итого: ${formatMoney(customs.duty + customsFee + item.commercial)}</b>`
      );
    }
    lines.push('');
  }

  lines.push(
    '<b>Дополнительные расходы, которые не включены в расчёт:</b>',
    '• услуги таможенного представителя;',
    '• доставка;',
    '• СВХ;',
    '• СБКТС и ЭПТС.',
    '',
    '<i>Расчёт предварительный.</i>'
  );
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
  await deleteBotMessage(env, message.chat.id, message.message_id, 'Working card cleanup');
}

async function cleanupTemporaryMessages(env, userId, chatId, exceptMessageId = null) {
  const state = await getMessageFlowState(env, userId);
  for (const messageId of mergeTemporaryMessageIds(state?.temporaryMessageIds)) {
    if (messageId === exceptMessageId) continue;
    await deleteBotMessage(env, chatId, messageId);
  }
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
  const state = await getCustomsState(env, userId);
  for (const messageId of mergeCustomsMessageIds(state?.cleanupMessageIds)) {
    if (messageId === exceptMessageId) continue;
    try {
      await telegram(env, 'deleteMessage', { chat_id: chatId, message_id: messageId });
    } catch (error) {
      console.warn('Customs message cleanup:', error.message || error);
    }
  }
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
    const deadline = parseDateFromPrompt(prompt, 'Крайний срок');
    if (!deadline) throw new Error('Не удалось восстановить крайний срок из сообщения');
    await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: [`<b>Крайний срок уплаты: ${formatDate(deadline)}</b>`, formatPeniCompact(cases, deadline, date)].join('\n'),
      parse_mode: 'HTML',
      reply_markup: calculationResultKeyboard(cases, deadline)
    });
  }
  return true;
}

async function sendCustomsCatalogPrompt(env, chatId, customsDuty, mode = 'passenger', customsCcm = null, customsValue = null, customsFee = null) {
  return sendCustomsPrompt(env, chatId, [
    mode === 'electric'
      ? '<b>Сначала определим автомобиль и его мощности</b>'
      : mode === 'under3'
        ? '<b>Найдём автомобиль для полного расчёта</b>'
        : '<b>Теперь рассчитаем утилизационный сбор</b>',
    '',
    'Введите марку, полную модель и год выпуска автомобиля.'
  ], 'Марка, модель и год', {
    stage: 'catalog-input', mode, customsDuty, customsCcm, customsValue, customsFee
  });
}

async function sendUnder3CatalogPrompt(env, chatId, userId = chatId, notice = '') {
  const lines = [
    '🚗 <b>Автомобили до 3 лет</b>',
    ''
  ];
  if (notice) lines.push(`<b>${escapeHtml(notice)}</b>`, '');
  lines.push(
    'Сначала найдём автомобиль в шаблоне СЭП.',
    '',
    '<b>Введите марку, модель и год выпуска автомобиля.</b>'
  );
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    reply_markup: customsKeyboard([
      [{ text: '🔄 Начать сначала', callback_data: 'customs:under3' }]
    ], 'customs:start')
  });
  await setCustomsState(env, userId, {
    stage: 'catalog-input',
    mode: 'under3',
    cleanupMessageIds: [sent.message_id]
  });
  await trackTemporaryMessage(env, userId, sent.message_id);
  return sent;
}

function electricCustomsVehicleLines(candidate, requestedWeight = null) {
  const power = electricCustomsPowerDetails(candidate);
  const lines = [
    `<b>Автомобиль:</b> ${escapeHtml(candidate.brand + ' ' + candidate.model)}, ${candidate.year}`,
    `<b>Тип автомобиля:</b> ${power.vehicleType}`
  ];
  if (power.combustionKw) {
    lines.push(`<b>Максимальная мощность ДВС:</b> ${power.combustionKw} кВт`);
  }
  lines.push(
    `<b>30-минутная мощность электромоторов:</b> ${power.electricKw} кВт`,
    `<b>Суммарная мощность для акциза:</b> ${power.excisePowerKw} кВт`,
    `<b>Мощность для утильсбора:</b> ${power.utilPowerKw} кВт (30-минутная)`
  );
  const weight = requestedWeight || candidate.mass;
  if (weight) lines.push(`<b>Технически допустимая масса:</b> ${weight} кг`);
  return lines;
}

function electricCustomsCurrencyText(candidate, requestedWeight = null, sourceParsed = null) {
  const lines = [
    '✅ <b>Автомобиль и мощности определены</b>',
    '',
    ...electricCustomsVehicleLines(candidate, requestedWeight),
    '',
    '<b>Выберите валюту, в которой будете указывать стоимость автомобиля.</b>',
    'Бот автоматически пересчитает сумму в рубли по курсу ЦБ РФ.'
  ];
  if (sourceParsed) lines.push('', catalogNavigationLine(sourceParsed));
  return lines.join('\n');
}

function electricCustomsCurrencyKeyboard(rowIndex, requestedWeight, backCallback = 'catalog:back:search') {
  const callback = code => `customs:electric:currency:${rowIndex}:${requestedWeight || 0}:${code}`;
  return customsKeyboard([
    [
      { text: ELECTRIC_CUSTOMS_CURRENCIES.RUB.button, callback_data: callback('RUB') },
      { text: ELECTRIC_CUSTOMS_CURRENCIES.USD.button, callback_data: callback('USD') }
    ],
    [
      { text: ELECTRIC_CUSTOMS_CURRENCIES.EUR.button, callback_data: callback('EUR') },
      { text: ELECTRIC_CUSTOMS_CURRENCIES.CNY.button, callback_data: callback('CNY') }
    ],
    [{ text: ELECTRIC_CUSTOMS_CURRENCIES.KRW.button, callback_data: callback('KRW') }]
  ], backCallback);
}

async function showElectricCustomsCurrencyPrompt(env, message, candidate, requestedWeight = null, backCallback = 'catalog:back:search', sourceParsed = null) {
  return telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: electricCustomsCurrencyText(candidate, requestedWeight, sourceParsed),
    parse_mode: 'HTML',
    reply_markup: electricCustomsCurrencyKeyboard(candidate.rowIndex, requestedWeight || candidate.mass, backCallback)
  });
}

async function sendElectricCustomsCurrencyPrompt(env, chatId, userId, candidate, requestedWeight = null) {
  const source = parseCatalogQuery(candidate.brand + ' ' + candidate.model + ' ' + candidate.year);
  await setCustomsState(env, userId, { stage: 'catalog-input', mode: 'electric' });
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: electricCustomsCurrencyText(candidate, requestedWeight, source),
    parse_mode: 'HTML',
    reply_markup: electricCustomsCurrencyKeyboard(candidate.rowIndex, requestedWeight || candidate.mass)
  });
  await trackTemporaryMessage(env, userId, sent.message_id);
  return sent;
}

function under3ElectricRedirectText(candidate, requestedWeight = null, sourceParsed = null) {
  const lines = [
    '⚠️ <b>Неправильно выбран раздел для расчёта</b>',
    '',
    catalogCandidateDescription(candidate, requestedWeight),
    '',
    'Выбранный автомобиль — <b>электромобиль</b>. Объём двигателя для него не используется.',
    '',
    'Для правильного расчёта перейдите в раздел «Электро и последовательные гибриды».'
  ];
  if (sourceParsed) lines.push('', catalogNavigationLine(sourceParsed));
  return lines.join('\n');
}

function under3ElectricRedirectKeyboard(candidate, requestedWeight = null, backCallback = 'customs:under3') {
  return customsKeyboard([[
    {
      text: '🪫 Перейти в «Электро/гибриды»',
      callback_data: `customs:electric:route:${candidate.rowIndex}:${requestedWeight || candidate.mass || 0}`
    }
  ]], backCallback);
}

async function showUnder3ElectricRedirect(env, message, candidate, requestedWeight, backCallback, sourceParsed) {
  return telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: under3ElectricRedirectText(candidate, requestedWeight, sourceParsed),
    parse_mode: 'HTML',
    reply_markup: under3ElectricRedirectKeyboard(candidate, requestedWeight, backCallback)
  });
}

async function sendUnder3ElectricRedirect(env, chatId, userId, candidate, requestedWeight, sourceParsed) {
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: under3ElectricRedirectText(candidate, requestedWeight, sourceParsed),
    parse_mode: 'HTML',
    reply_markup: under3ElectricRedirectKeyboard(candidate, requestedWeight)
  });
  await setCustomsState(env, userId, {
    stage: 'catalog-input',
    mode: 'under3',
    cleanupMessageIds: [sent.message_id]
  });
  await trackTemporaryMessage(env, userId, sent.message_id);
  return sent;
}

async function sendElectricCustomsValuePrompt(env, chatId, candidate, requestedWeight, currencyCode, cleanupMessageIds = []) {
  const currency = electricCustomsCurrency(currencyCode);
  if (!currency) throw new Error('Неизвестная валюта стоимости');
  return sendCustomsPrompt(env, chatId, [
    `<b>Введите предполагаемую стоимость автомобиля в ${currency.name}.</b>`,
    `<i>Выбрано: ${currency.button} (${currency.code}). Укажите сумму одним числом.</i>`
  ], `Стоимость в ${currency.code}`, {
    stage: 'electric-value', rowIndex: candidate.rowIndex,
    requestedWeight: requestedWeight || candidate.mass || null,
    currency: currency.code,
    cleanupMessageIds
  });
}

async function handleCustomsCallback(env, query) {
  const message = query.message;
  const data = query.data;
  if (data === 'customs:result:menu') {
    await clearCustomsState(env, query.from?.id || message.chat.id);
    return sendMenu(env, message.chat.id);
  }
  if (data === 'customs:result:new') {
    await clearCustomsState(env, query.from?.id || message.chat.id);
    return sendCustomsIntro(env, message.chat.id);
  }
  const editElectricValue = data.match(/^customs:electric:edit:(\d+):(\d+(?:\.\d+)?)$/);
  if (editElectricValue) {
    const userId = query.from?.id || message.chat.id;
    const catalog = await loadCatalog(env.CATALOG_URL);
    const candidate = getCatalogCandidate(catalog, Number(editElectricValue[1]));
    if (!candidate) throw new Error('Выбранный автомобиль больше не найден в шаблоне СЭП');
    electricCustomsPowerDetails(candidate);
    await cleanupCustomsMessages(env, userId, message.chat.id);
    await cleanupTemporaryMessages(env, userId, message.chat.id);
    return sendElectricCustomsCurrencyPrompt(
      env, message.chat.id, userId, candidate,
      Number(editElectricValue[2]) || candidate.mass || null
    );
  }
  const electricCurrency = data.match(/^customs:electric:currency:(\d+):(\d+(?:\.\d+)?):(RUB|USD|EUR|CNY|KRW)$/);
  if (electricCurrency) {
    const userId = query.from?.id || message.chat.id;
    const catalog = await loadCatalog(env.CATALOG_URL);
    const candidate = getCatalogCandidate(catalog, Number(electricCurrency[1]));
    if (!candidate) throw new Error('Выбранный автомобиль больше не найден в шаблоне СЭП');
    electricCustomsPowerDetails(candidate);
    await discardWorkingCard(env, message, userId);
    return sendElectricCustomsValuePrompt(
      env,
      message.chat.id,
      candidate,
      Number(electricCurrency[2]) || candidate.mass || null,
      electricCurrency[3]
    );
  }
  const electricRoute = data.match(/^customs:electric:route:(\d+):(\d+(?:\.\d+)?)$/);
  if (electricRoute) {
    const userId = query.from?.id || message.chat.id;
    const catalog = await loadCatalog(env.CATALOG_URL);
    const candidate = getCatalogCandidate(catalog, Number(electricRoute[1]));
    if (!candidate) throw new Error('Выбранный автомобиль больше не найден в шаблоне СЭП');
    electricCustomsPowerDetails(candidate);
    const requestedWeight = Number(electricRoute[2]) || candidate.mass || null;
    const source = parseCatalogQuery(candidate.brand + ' ' + candidate.model + ' ' + candidate.year);
    source.customsMode = 'electric';
    await setCustomsState(env, userId, { stage: 'catalog-input', mode: 'electric' });
    return showElectricCustomsCurrencyPrompt(
      env,
      message,
      candidate,
      requestedWeight,
      `catalog:back:variants:${candidate.rowIndex}`,
      source
    );
  }
  const under3Volume = data.match(/^customs:under3:volume:(\d+):(\d+(?:\.\d+)?)$/);
  if (under3Volume) {
    const userId = query.from?.id || message.chat.id;
    const catalog = await loadCatalog(env.CATALOG_URL);
    const candidate = getCatalogCandidate(catalog, Number(under3Volume[1]));
    if (!candidate) throw new Error('Выбранный автомобиль больше не найден в шаблоне СЭП');
    const requestedWeight = Number(under3Volume[2]) || candidate.mass || null;
    await discardWorkingCard(env, message, userId);
    return sendCustomsPrompt(env, message.chat.id, [
      '✅ <b>Автомобиль выбран</b>',
      '',
      catalogCandidateDescription(candidate, requestedWeight),
      '',
      '<b>Укажите точный объём двигателя в см³.</b>',
      '<i>Например: 1998</i>'
    ], 'Объём двигателя, см³', {
      stage: 'under3-selected-volume',
      rowIndex: candidate.rowIndex,
      requestedWeight
    });
  }
  if (data === 'customs:start') return showCustomsIntro(env, message);
  if (data === 'customs:under3') {
    const userId = query.from?.id || message.chat.id;
    await cleanupCustomsMessages(env, userId, message.chat.id);
    await discardWorkingCard(env, message, userId);
    return sendUnder3CatalogPrompt(env, message.chat.id, userId);
  }
  if (data === 'customs:over3') {
    await cleanupCustomsMessages(env, query.from?.id || message.chat.id, message.chat.id, message.message_id);
    return editCustomsScreen(env, message, [
      '🚙 <b>Автомобили старше 3 лет</b>',
      '',
      'Для автомобилей категории M1, кроме электромобилей и последовательных гибридов, пошлина рассчитывается по объёму двигателя.',
      '',
      'Выберите возрастную группу:'
    ].join('\n'), [
      [{ text: 'От 3 до 5 лет', callback_data: 'customs:over3:3-5' }],
      [{ text: 'Старше 5 лет', callback_data: 'customs:over3:5+' }]
    ]);
  }
  const over3 = data.match(/^customs:over3:(3-5|5\+)$/);
  if (over3) {
    await discardWorkingCard(env, message, query.from?.id || message.chat.id);
    return sendCustomsPrompt(env, message.chat.id, [
      '<b>Укажите точный объём двигателя в см³.</b>',
      '<i>Например: 1998</i>'
    ], 'Объём двигателя, см³', {
      stage: 'over3-volume', ageGroup: over3[1], cleanupMessageIds: [message.message_id]
    });
  }
  if (data === 'customs:electric') {
    await cleanupCustomsMessages(env, query.from?.id || message.chat.id, message.chat.id, message.message_id);
    return editCustomsScreen(env, message, [
      '⚡ <b>Электромобили и последовательные гибриды</b>',
      '',
      'Сначала определяем точную модель и мощности автомобиля.',
      '',
      'Для акциза учитывается суммарная мощность ДВС и электромоторов. Для утильсбора — только 30-минутная мощность электромоторов.',
      '',
      'После выбора автомобиля бот запросит стоимость и покажет пошлину 15%, акциз, НДС 22%, утильсбор и общую сумму.'
    ].join('\n'), [[{ text: 'Выбрать автомобиль', callback_data: 'customs:electric:car' }]]);
  }
  if (data === 'customs:electric:car') {
    await setCustomsState(env, query.from?.id || message.chat.id, { cleanupMessageIds: [message.message_id] });
    await discardWorkingCard(env, message, query.from?.id || message.chat.id);
    return sendCustomsCatalogPrompt(env, message.chat.id, null, 'electric');
  }
  if (data === 'customs:pickup') {
    await cleanupCustomsMessages(env, query.from?.id || message.chat.id, message.chat.id, message.message_id);
    return editCustomsScreen(env, message, [
      '🛻 <b>Пикапы категории N1/N1G до 5 тонн</b>',
      '',
      'Выберите возраст автомобиля. Затем бот уточнит топливо, стоимость и только необходимые для выбранной ставки характеристики.'
    ].join('\n'), [
      [{ text: '0–3 года', callback_data: 'customs:pickup:age:0-3' }, { text: '3–5 лет', callback_data: 'customs:pickup:age:3-5' }],
      [{ text: '5–7 лет', callback_data: 'customs:pickup:age:5-7' }, { text: '7 лет и старше', callback_data: 'customs:pickup:age:7+' }]
    ]);
  }
  const pickupAge = data.match(/^customs:pickup:age:(0-3|3-5|5-7|7\+)$/);
  if (pickupAge) {
    return editCustomsScreen(env, message, [
      '🛻 <b>Пикап ' + escapeHtml(pickupAge[1]) + '</b>',
      '',
      'Выберите тип топлива:'
    ].join('\n'), [[
      { text: 'Бензин', callback_data: `customs:pickup:fuel:${pickupAge[1]}:petrol` },
      { text: 'Дизель', callback_data: `customs:pickup:fuel:${pickupAge[1]}:diesel` }
    ]], 'customs:pickup');
  }
  const pickupFuel = data.match(/^customs:pickup:fuel:(0-3|3-5|5-7|7\+):(petrol|diesel)$/);
  if (pickupFuel) {
    await discardWorkingCard(env, message, query.from?.id || message.chat.id);
    return sendCustomsPrompt(env, message.chat.id, [
      '<b>Укажите предполагаемую стоимость пикапа в рублях.</b>',
      '<i>Например: 3 500 000</i>'
    ], 'Стоимость в рублях', {
      stage: 'pickup-value', ageGroup: pickupFuel[1], fuel: pickupFuel[2],
      cleanupMessageIds: [message.message_id]
    });
  }
  const catalog = data.match(/^customs:catalog:(\d+):(\d+(?:\.\d+)?)$/);
  if (catalog) {
    const state = await getCustomsState(env, query.from?.id || message.chat.id);
    await cleanupCustomsMessages(env, query.from?.id || message.chat.id, message.chat.id);
    return sendCustomsCatalogPrompt(
      env, message.chat.id, Number(catalog[1]), 'passenger', Number(catalog[2]),
      state?.customsValue || null, state?.customsFee || null
    );
  }
  if (data === 'customs:advice') {
    return editCustomsScreen(env, message, [
      '💡 <b>Какой автомобиль выгоднее?</b>',
      '',
      'Нельзя сравнивать автомобили только по таможенной пошлине: возрастная группа с меньшей пошлиной может дать значительно больший утильсбор.',
      '',
      'Корректное сравнение — это таможенный платёж + утильсбор по конкретной модели, году, объёму и мощности.',
      '',
      'ИИ-консультанта добавим отдельным следующим этапом.'
    ].join('\n'), [[{ text: '☎️ Получить консультацию', callback_data: 'info:contact' }]]);
  }
}

async function handleCustomsReply(env, message) {
  const userId = message.from?.id || message.chat?.id;
  const state = await getCustomsState(env, userId);
  const stage = state?.stage;
  const mode = state?.mode;
  if (!stage) return false;
  await trackCustomsMessages(
    env,
    userId,
    state,
    message.reply_to_message?.message_id
  );

  if (stage === 'catalog-input' && ['passenger', 'electric', 'under3'].includes(mode)) {
    const parsed = parseCatalogQuery(message.text);
    if (!parsed) {
      if (mode === 'under3') {
        await cleanupCustomsMessages(env, userId, message.chat.id);
        await cleanupTemporaryMessages(env, userId, message.chat.id);
        await sendUnder3CatalogPrompt(
          env,
          message.chat.id,
          userId,
          'Укажите марку, модель и четырёхзначный год выпуска.'
        );
        return true;
      }
      await sendCustomsNotice(env, message.chat.id, 'Укажите марку, полную модель и четырёхзначный год выпуска.');
      await sendCustomsCatalogPrompt(
        env,
        message.chat.id,
        state.customsDuty,
        mode,
        state.customsCcm,
        state.customsValue,
        state.customsFee
      );
      return true;
    }
    parsed.customsMode = mode;
    parsed.customsDuty = state.customsDuty;
    parsed.customsCcm = state.customsCcm;
    parsed.customsValue = state.customsValue;
    parsed.customsFee = state.customsFee;
    await cleanupCustomsMessages(env, userId, message.chat.id);
    await setCustomsState(env, userId, {
      stage: 'catalog-input', mode,
      customsDuty: state.customsDuty, customsCcm: state.customsCcm,
      customsValue: state.customsValue, customsFee: state.customsFee
    });
    await runCatalogTextSearch(env, message, parsed);
    return true;
  }

  if (stage === 'under3-selected-volume') {
    const ccm = parsePositiveNumber(message.text);
    const rowIndex = Number(state.rowIndex);
    if (!ccm || !Number.isInteger(rowIndex) || rowIndex < 0) {
      await sendCustomsNotice(env, message.chat.id, 'Не удалось распознать объём. Введите точное значение в см³, например 1998.');
      return true;
    }
    const catalog = await loadCatalog(env.CATALOG_URL);
    const candidate = getCatalogCandidate(catalog, rowIndex);
    if (!candidate) throw new Error('Выбранный автомобиль больше не найден в шаблоне СЭП');
    if (!candidate.combustionKw && candidate.electricKw) {
      const requestedWeight = parsePositiveNumber(state.requestedWeight) || candidate.mass || null;
      const source = parseCatalogQuery(candidate.brand + ' ' + candidate.model + ' ' + candidate.year);
      source.customsMode = 'under3';
      await cleanupCustomsMessages(env, userId, message.chat.id);
      await cleanupTemporaryMessages(env, userId, message.chat.id);
      await sendUnder3ElectricRedirect(env, message.chat.id, userId, candidate, requestedWeight, source);
      return true;
    }
    const requestedWeight = parsePositiveNumber(state.requestedWeight) || candidate.mass || null;
    await cleanupCustomsMessages(env, userId, message.chat.id);
    await sendCustomsPrompt(env, message.chat.id, [
      '✅ <b>Данные автомобиля получены</b>',
      '',
      catalogCandidateDescription(candidate, requestedWeight),
      `Объём двигателя: ${ccm} см³`,
      '',
      '<b>Укажите предполагаемую стоимость автомобиля в рублях.</b>',
      'Для автомобиля до 3 лет таможенный платёж рассчитывается от стоимости.'
    ], 'Стоимость в рублях', {
      stage: 'under3-selected-value',
      rowIndex,
      requestedWeight,
      engineCc: ccm
    });
    return true;
  }

  if (stage === 'under3-selected-value') {
    const value = parsePositiveNumber(message.text);
    const ccm = parsePositiveNumber(state.engineCc);
    const rowIndex = Number(state.rowIndex);
    if (!value || !ccm || !Number.isInteger(rowIndex) || rowIndex < 0) {
      await sendCustomsNotice(env, message.chat.id, 'Не удалось распознать стоимость. Введите сумму одним числом в рублях.');
      return true;
    }
    const catalog = await loadCatalog(env.CATALOG_URL);
    const candidate = getCatalogCandidate(catalog, rowIndex);
    if (!candidate) throw new Error('Выбранный автомобиль больше не найден в шаблоне СЭП');
    const requestedWeight = parsePositiveNumber(state.requestedWeight) || candidate.mass || null;
    const totalKw = calculationPower(candidate, false);
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
      hybridType: 'ДВС / параллельный гибрид'
    };
    const rate = await euroRate(env);
    const customs = calculatePassengerUnder3({ customsValueRub: value, engineCc: ccm, euroRate: rate });
    const customsFee = calculateCustomsProcessingFee(value);
    const util = calculateUtil(vehicle);
    await cleanupCustomsMessages(env, userId, message.chat.id);
    await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: under3CustomsResultText(candidate, vehicle, customs, customsFee, util, rate),
      parse_mode: 'HTML',
      reply_markup: customsResultKeyboard()
    });
    await saveApplication(env, userId, customsApplicationFromVehicle(vehicle, util, {
      customsValue: value,
      customsPayments: customs.duty,
      customsFee
    }));
    await clearCustomsState(env, userId);
    return true;
  }

  if (stage === 'over3-volume') {
    const ccm = parsePositiveNumber(message.text);
    const ageGroup = state.ageGroup;
    if (!ccm || !['3-5', '5+'].includes(ageGroup)) {
      await sendCustomsNotice(env, message.chat.id, 'Не удалось распознать объём двигателя. Введите число в см³.');
      return true;
    }
    const rate = await euroRate(env);
    const result = calculatePassengerOver3({ ageGroup, engineCc: ccm, euroRate: rate });
    await cleanupCustomsMessages(env, userId, message.chat.id);
    await sendCustomsPrompt(env, message.chat.id, [
      '<b>Пошлина по объёму двигателя рассчитана.</b>',
      `Сумма пошлины: ${formatMoney(result.duty)}`,
      '',
      'Укажите предполагаемую таможенную стоимость автомобиля — она нужна для расчёта государственного таможенного сбора.'
    ], 'Стоимость автомобиля в рублях', {
      stage: 'over3-value', ageGroup, engineCc: ccm, customsDuty: result.duty, euroRate: rate
    });
    return true;
  }

  if (stage === 'over3-value') {
    const value = parsePositiveNumber(message.text);
    const ccm = parsePositiveNumber(state.engineCc);
    const duty = parsePositiveNumber(state.customsDuty);
    const ageGroup = state.ageGroup;
    if (!value || !ccm || !duty || !['3-5', '5+'].includes(ageGroup)) {
      await sendCustomsNotice(env, message.chat.id, 'Не удалось распознать стоимость. Введите сумму одним числом в рублях.');
      return true;
    }
    const customsFee = calculateCustomsProcessingFee(value);
    const rate = parsePositiveNumber(state.euroRate) || await euroRate(env);
    const result = calculatePassengerOver3({ ageGroup, engineCc: ccm, euroRate: rate });
    await cleanupCustomsMessages(env, userId, message.chat.id);
    const sent = await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: [
        '✅ <b>Таможенный платёж рассчитан</b>',
        '',
        `Возраст: ${ageGroup === '3-5' ? 'от 3 до 5 лет' : 'старше 5 лет'}`,
        `Объём двигателя: ${ccm} см³`,
        `Ставка: ${result.euroPerCc} €/см³`,
        `<b>Таможенная пошлина: ${formatMoney(duty)}</b>`,
        `Таможенный сбор за операции: ${formatMoney(customsFee)}`,
        `<b>Таможенные платежи всего: ${formatMoney(duty + customsFee)}</b>`,
        `Курс евро ЦБ РФ: ${rate.toFixed(4)} ₽`,
        '',
        '<i>Расчёт предварительный.</i>'
      ].join('\n'),
      parse_mode: 'HTML',
      reply_markup: customsKeyboard([[{ text: 'Перейти к расчёту утильсбора', callback_data: `customs:catalog:${duty}:${ccm}` }]], 'customs:over3')
    });
    await setCustomsState(env, userId, {
      stage: 'customs-duty-ready', mode: 'passenger', customsDuty: duty,
      customsCcm: ccm, customsValue: value, customsFee,
      cleanupMessageIds: [sent.message_id]
    });
    return true;
  }

  if (stage === 'electric-value') {
    const enteredValue = parsePositiveNumber(message.text);
    const currency = electricCustomsCurrency(state.currency || 'RUB');
    const rowIndex = Number(state.rowIndex);
    const requestedWeight = parsePositiveNumber(state.requestedWeight);
    if (!enteredValue || !currency || !Number.isInteger(rowIndex) || rowIndex < 0) {
      await sendCustomsNotice(env, message.chat.id, 'Не удалось распознать стоимость. Введите сумму одним числом в выбранной валюте.');
      return true;
    }
    let currencyRate;
    try {
      currencyRate = await cbrCurrencyRate(currency.code);
    } catch (error) {
      await sendCustomsNotice(env, message.chat.id, `Не удалось получить курс ЦБ РФ: ${escapeHtml(error.message || error)}. Попробуйте ещё раз позже.`);
      return true;
    }
    const value = convertCurrencyToRub(enteredValue, currencyRate);
    const catalog = await loadCatalog(env.CATALOG_URL);
    const candidate = getCatalogCandidate(catalog, rowIndex);
    const power = electricCustomsPowerDetails(candidate);
    const utilPowerKw = power.utilPowerKw;
    const excisePowerKw = power.excisePowerKw;
    const vehicle = {
      type: 'catalog', brand: candidate.brand, model: candidate.model, vin: null, surname: null,
      year: candidate.year, category: 'M1', ccm: null,
      combustionKw: candidate.combustionKw || 0,
      electricKw: [candidate.electricKw], totalKw: utilPowerKw,
      maxMass: requestedWeight || candidate.mass || null, issueDate: null,
      hybridType: power.vehicleType
    };
    const util = calculateUtil(vehicle);
    const customs = calculateElectricCustoms({ customsValueRub: value, excisePowerKw });
    const customsFee = calculateCustomsProcessingFee(value);
    const lines = [
      '✅ <b>Предварительный таможенный расчёт</b>',
      '',
      ...electricCustomsVehicleLines(candidate, requestedWeight),
      `<b>Указанная стоимость:</b> ${formatCurrencyAmount(enteredValue, currency.code)}`,
      ...(currency.code === 'RUB' ? [] : [
        formatCbrRate(currencyRate),
        `<b>Таможенная стоимость в рублях:</b> ${formatMoney(value)}`
      ]),
      '',
      `Ввозная пошлина 15%: ${formatMoney(customs.duty)}`,
      `Акциз (${customs.excisePerHp} ₽ за 0,75 кВт): ${formatMoney(customs.excise)}`,
      `НДС 22%: ${formatMoney(customs.vat)}`,
      `Таможенный сбор за операции: ${formatMoney(customsFee)}`,
      `<b>Таможенные платежи: ${formatMoney(customs.customsTotal + customsFee)}</b>`,
      ''
    ];
    for (const item of util) {
      const utilAmount = item.personal !== item.commercial ? item.personal : item.commercial;
      lines.push(`<b>Утильсбор (${ageLabel(item.age)}): ${formatMoney(utilAmount)}</b>`);
      lines.push(`<b>Итого: ${formatMoney(customs.customsTotal + customsFee + utilAmount)}</b>`);
    }
    lines.push('', '<i>Расчёт предварительный. Услуги таможенного представителя и иные сопутствующие расходы не включены.</i>');
    await cleanupCustomsMessages(env, userId, message.chat.id);
    await telegram(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      reply_markup: electricCustomsResultKeyboard(candidate.rowIndex, requestedWeight || candidate.mass)
    });
    await saveApplication(env, userId, customsApplicationFromVehicle(vehicle, util, {
      customsValue: value,
      customsPayments: customs.customsTotal,
      customsFee
    }));
    await clearCustomsState(env, userId);
    return true;
  }

  if (stage === 'pickup-value') {
    const value = parsePositiveNumber(message.text);
    const age = state.ageGroup;
    const fuel = state.fuel;
    if (!value || !age || !fuel) return true;
    const needsCcm = age === '7+' || (fuel === 'petrol' && age === '0-3') || (fuel === 'diesel' && age === '5-7');
    await cleanupCustomsMessages(env, userId, message.chat.id);
    if (needsCcm) {
      await sendCustomsPrompt(env, message.chat.id, [
        '<b>Для выбранной ставки нужен объём двигателя.</b>',
        'Укажите точный объём в см³.'
      ], 'Объём двигателя, см³', { stage: 'pickup-volume', customsValueRub: value, ageGroup: age, fuel });
    } else {
      await sendCustomsPrompt(env, message.chat.id, [
        '<b>Укажите полную технически допустимую массу по шильдику.</b>'
      ], 'Полная масса, кг', { stage: 'pickup-mass', customsValueRub: value, ageGroup: age, fuel, engineCc: 1 });
    }
    return true;
  }

  if (stage === 'pickup-volume') {
    const ccm = parsePositiveNumber(message.text);
    if (!ccm) return true;
    await cleanupCustomsMessages(env, userId, message.chat.id);
    await sendCustomsPrompt(env, message.chat.id, [
      '<b>Укажите полную технически допустимую массу по шильдику.</b>'
    ], 'Полная масса, кг', {
      stage: 'pickup-mass', customsValueRub: state.customsValueRub,
      ageGroup: state.ageGroup, fuel: state.fuel, engineCc: ccm
    });
    return true;
  }

  if (stage === 'pickup-mass') {
    const mass = parsePositiveNumber(message.text);
    const value = parsePositiveNumber(state.customsValueRub);
    const ccm = parsePositiveNumber(state.engineCc);
    const ageGroup = state.ageGroup;
    const fuel = state.fuel;
    if (!mass || !value || !ccm) return true;
    try {
      const rate = await euroRate(env);
      const result = calculatePickup({ customsValueRub: value, fuel, ageGroup, engineCc: ccm, maxMassKg: mass, euroRate: rate });
      const customsFee = calculateCustomsProcessingFee(value);
      await cleanupCustomsMessages(env, userId, message.chat.id);
      await telegram(env, 'sendMessage', {
        chat_id: message.chat.id,
        text: [
          '✅ <b>Предварительный расчёт пикапа</b>',
          '',
          `Ввозная пошлина: ${formatMoney(result.duty)}`,
          `НДС 22%: ${formatMoney(result.vat)}`,
          `Таможенный сбор за операции: ${formatMoney(customsFee)}`,
          `<b>Таможенные платежи: ${formatMoney(result.customsTotal + customsFee)}</b>`,
          `Утилизационный сбор: ${formatMoney(result.util)}`,
          `<b>Итого: ${formatMoney(result.total + customsFee)}</b>`,
          '',
          '<i>Услуги таможенного представителя не включены. Окончательная сумма зависит от классификации автомобиля и таможенной стоимости.</i>'
        ].join('\n'),
        parse_mode: 'HTML',
        reply_markup: customsResultKeyboard()
      });
      await saveApplication(env, userId, {
        source: 'Таможенный расчёт', calculationType: 'customs',
        brand: 'Пикап', model: fuel === 'petrol' ? 'бензин' : 'дизель',
        category: 'N1/N1G', ccm, customsValue: value,
        customsDuty: result.customsTotal, customsFee, utilAmount: result.util,
        amount: result.total + customsFee,
        amountLabel: ageGroup
      });
      await clearCustomsState(env, userId);
    } catch (error) {
      await sendCustomsNotice(env, message.chat.id, escapeHtml(error.message || error));
    }
    return true;
  }

  return false;
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

function catalogNavigationLine(parsed) {
  if (!parsed) return '';
  return '<i>Исходный запрос: ' + escapeHtml(parsed.vehicleText + ' ' + parsed.year) + '</i>';
}

function catalogQueryFromNavigationMessage(message) {
  const source = message?.text?.match(/Исходный запрос:\s*(.+)/i)?.[1]?.trim();
  const parsed = source ? parseCatalogQuery(source) : null;
  return parsed;
}

function withCustomsState(parsed, state) {
  if (!parsed || state?.stage !== 'catalog-input') return parsed;
  parsed.customsMode = state.mode || null;
  parsed.customsDuty = state.customsDuty || null;
  parsed.customsCcm = state.customsCcm || null;
  parsed.customsValue = state.customsValue || null;
  parsed.customsFee = state.customsFee || null;
  return parsed;
}

function catalogSearchKeyboard() {
  return {
    inline_keyboard: [[{ text: '🏠 Главное меню', callback_data: 'calc:menu' }]]
  };
}

function catalogSearchPrompt() {
  return [
    '<b>Поиск автомобиля по шаблону СЭП</b>',
    '',
    'Напишите марку, модель и год выпуска.'
  ].join('\n');
}

function catalogModificationsText(modifications, parsed, page = 0) {
  const pagination = paginateCatalogModifications(modifications, page);
  return [
    modifications.length === 1
      ? 'Для запроса найдена одна модификация.'
      : 'Найдено несколько модификаций — <b>' + modifications.length + '</b>.',
    '',
    'Выберите точную модификацию автомобиля:',
    pagination.pageCount > 1
      ? `Показаны варианты ${pagination.startIndex + 1}–${pagination.startIndex + pagination.items.length} из ${pagination.total}.`
      : '',
    '',
    catalogNavigationLine(parsed)
  ].filter(Boolean).join('\n');
}

function catalogCandidateDescription(candidate, requestedWeight = null) {
  const power = [];
  if (candidate.combustionKw) power.push(candidate.combustionKw + ' кВт макс.');
  if (candidate.electricKw) power.push(candidate.electricKw + ' кВт (30 мин)');
  return [
    '<b>' + escapeHtml([candidate.brand, candidate.model].filter(Boolean).join(' ')) + '</b>, ' + candidate.year,
    power.length ? 'Мощность в шаблоне СЭП: ' + power.join(' + ') : 'Мощность в шаблоне СЭП не указана',
    requestedWeight || candidate.mass
      ? 'Технически допустимая масса: ' + (requestedWeight || candidate.mass) + ' кг'
      : candidate.massFrom && candidate.massTo
        ? 'Диапазон массы: ' + candidate.massFrom + '–' + candidate.massTo + ' кг'
        : ''
  ].filter(Boolean).join('\n');
}

function catalogVariantsKeyboard(matches, weight) {
  return {
    inline_keyboard: [
      ...matches.map(candidate => [{
        text: compactButtonText(
          candidate.brand + ' ' + candidate.model + ' · ' +
          (candidate.combustionKw || 0) +
          (candidate.electricKw ? ' + ' + candidate.electricKw : '') + ' кВт · ' + weight + ' кг'
        ),
        callback_data: 'catalog:pick:' + candidate.rowIndex + ':' + weight
      }]),
      [
        { text: '← Назад', callback_data: 'catalog:back:weight' },
        { text: '🏠 Главное меню', callback_data: 'calc:menu' }
      ]
    ]
  };
}

function catalogModificationKeyboard(modifications, page = 0) {
  const pagination = paginateCatalogModifications(modifications, page);
  const pageButtons = [];
  if (pagination.pageCount > 1) {
    if (pagination.currentPage > 0) {
      pageButtons.push({ text: '‹ Предыдущие', callback_data: `catalog:mods:${pagination.currentPage - 1}` });
    }
    pageButtons.push({ text: `${pagination.currentPage + 1}/${pagination.pageCount}`, callback_data: 'catalog:noop' });
    if (pagination.currentPage < pagination.pageCount - 1) {
      pageButtons.push({ text: 'Следующие ›', callback_data: `catalog:mods:${pagination.currentPage + 1}` });
    }
  }
  return {
    inline_keyboard: [
      ...pagination.items.map(item => [{
        text: compactButtonText(item.model),
        callback_data: 'catalog:model:' + item.brandIndex + ':' + item.modelIndex + ':' + item.year + ':' + pagination.currentPage
      }]),
      ...(pageButtons.length ? [pageButtons] : []),
      [
        { text: '← Назад', callback_data: 'catalog:back:search' },
        { text: '🏠 Главное меню', callback_data: 'calc:menu' }
      ]
    ]
  };
}

function catalogVariantPower(candidate) {
  return Math.round((candidate.combustionKw + candidate.electricKw) * 100) / 100;
}

function catalogPowerMassKeyboard(variants, brandIndex, modelIndex, year, page = 0, modificationsPage = 0) {
  const pagination = paginateCatalogVariants(variants, page);
  const pageButtons = [];
  if (pagination.pageCount > 1) {
    if (pagination.currentPage > 0) {
      pageButtons.push({
        text: '‹ Предыдущие',
        callback_data: `catalog:variants:${brandIndex}:${modelIndex}:${year}:${pagination.currentPage - 1}:${modificationsPage}`
      });
    }
    pageButtons.push({ text: `${pagination.currentPage + 1}/${pagination.pageCount}`, callback_data: 'catalog:noop' });
    if (pagination.currentPage < pagination.pageCount - 1) {
      pageButtons.push({
        text: 'Следующие ›',
        callback_data: `catalog:variants:${brandIndex}:${modelIndex}:${year}:${pagination.currentPage + 1}:${modificationsPage}`
      });
    }
  }
  return {
    inline_keyboard: [
      ...pagination.items.map(candidate => {
        const kw = catalogVariantPower(candidate);
        const hp = Math.round(kw / 0.7355);
        return [{
          text: compactButtonText(kw + ' кВт / ' + hp + ' л.с. — ' + candidate.mass + ' кг'),
          callback_data: 'catalog:pick:' + candidate.rowIndex + ':' + candidate.mass + ':' + pagination.currentPage + ':' + modificationsPage
        }];
      }),
      ...(pageButtons.length ? [pageButtons] : []),
      [
        { text: '← Назад', callback_data: `catalog:mods:${modificationsPage}` },
        { text: '🏠 Главное меню', callback_data: 'calc:menu' }
      ]
    ]
  };
}

function catalogEngineKeyboard(rowIndex, weight, backCallback, sourceParsed = null) {
  if (sourceParsed?.customsMode === 'passenger' && sourceParsed.customsCcm) {
    return {
      inline_keyboard: [
        [{
          text: 'Продолжить · ' + sourceParsed.customsCcm + ' см³',
          callback_data: 'catalog:calc:' + rowIndex + ':' + sourceParsed.customsCcm + ':' + weight
        }],
        [
          { text: '← Назад', callback_data: backCallback },
          { text: '🏠 Главное меню', callback_data: 'calc:menu' }
        ]
      ]
    };
  }
  const buttons = CATALOG_CCM_BUCKETS.map(bucket => ({
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
  if (customs?.customsPayments) {
    lines.push('<b>Общий расчёт:</b>');
    if (customs.customsValue) lines.push('Таможенная стоимость: ' + formatMoney(customs.customsValue));
    lines.push('Таможенная пошлина: ' + formatMoney(customs.customsPayments));
    lines.push('Таможенный сбор за операции: ' + formatMoney(customs.customsFee));
    for (const item of util) {
      const utilAmount = item.personal !== item.commercial ? item.personal : item.commercial;
      lines.push('<b>Итого (' + ageLabel(item.age) + '): ' + formatMoney(customs.customsPayments + customs.customsFee + utilAmount) + '</b>');
    }
    lines.push('');
    lines.push('<i>Расчёт предварительный. Услуги таможенного представителя и иные сопутствующие расходы не включены.</i>');
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
      await telegram(env, 'deleteMessage', { chat_id: message.chat.id, message_id: message.message_id });
      await sendCustomsCatalogPrompt(
        env,
        message.chat.id,
        sourceParsed.customsDuty,
        sourceParsed.customsMode,
        sourceParsed.customsCcm,
        sourceParsed.customsValue,
        sourceParsed.customsFee
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
    await telegram(env, 'deleteMessage', {
      chat_id: message.chat.id,
      message_id: message.message_id
    });
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
      : 0)
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
    const sent = await telegram(env, 'sendMessage', { chat_id: message.chat.id, text: 'Пожалуйста, отправьте документ в формате PDF.' });
    await trackTemporaryMessage(env, userId, sent.message_id);
    return;
  }
  if (document.file_size > 20 * 1024 * 1024) {
    const userId = message.from?.id || message.chat.id;
    await cleanupTemporaryMessages(env, userId, message.chat.id);
    const sent = await telegram(env, 'sendMessage', { chat_id: message.chat.id, text: 'Файл больше 20 МБ. Telegram не позволяет боту скачать такой документ.' });
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
      reply_markup: calculationResultKeyboard(cases, deadline)
    });
    await releaseTemporaryMessage(env, userId, status.message_id);
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
  await cleanupCustomsMessages(env, chatId, chatId);
  await cleanupTemporaryMessages(env, chatId, chatId);
  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: MENU_TEXT,
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
    await deleteBotMessage(env, message.chat.id, message.message_id, 'Working card cleanup');
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
    if (command === '/start' || command === '/menu' || command === '/help') {
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
      if (request.method === 'GET' && url.pathname === '/api/rates/eur') {
        return new Response(JSON.stringify({ ok: true, rate: await euroRate(env) }), { headers: apiHeaders(env) });
      }
      if (request.method === 'GET' && url.pathname.startsWith('/setup/')) return setupBot(request, env);
      if (request.method === 'GET' && url.pathname === '/') {
        return Response.json({ ok: true, service: 'grani-telegram-bot', version: 'under3-electric-route-v14' });
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
