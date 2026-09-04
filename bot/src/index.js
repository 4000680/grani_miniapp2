const MENU_TEXT = [
  '<b>Здравствуйте! Я помощник компании «Брокер ГРАНИ».</b>',
  '',
  'Поможем с оформлением автомобиля:',
  '• СБКТС и ЭПТС;',
  '• утилизационный сбор и пени;',
  '• таможенное оформление;',
  '• внесение собственника в ЭПТС.',
  '',
  'Выберите нужный раздел 👇'
].join('\n');

const INFO = {
  payment: {
    title: '💳 <b>Как оплатить утильсбор</b>',
    text: [
      'Перед оплатой необходимо проверить сумму, данные плательщика, VIN и характеристики автомобиля.',
      '',
      'Актуальные реквизиты и назначение платежа зависят от способа оформления. После оплаты сохраните чек или платёжное поручение.',
      '',
      '<i>Не переводите деньги по реквизитам, полученным из старых документов или непроверенных источников.</i>'
    ].join('\n')
  },
  sbkts: {
    title: '📄 <b>Оформить СБКТС</b>',
    text: [
      'Поможем проверить исходные данные автомобиля и сопроводим оформление СБКТС.',
      '',
      'Для предварительной проверки подготовьте VIN и имеющиеся документы на автомобиль. Точный перечень документов, стоимость и срок сообщит специалист.'
    ].join('\n')
  },
  epts: {
    title: '🔎 <b>Найти ЭПТС по VIN</b>',
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
    title: '💬 <b>Написать нам</b>',
    text: 'Опишите вопрос и, если он связан с автомобилем, подготовьте VIN и имеющиеся документы. Так специалист сможет ответить точнее.'
  },
  donate: {
    title: '❤️ <b>Поддержать проект</b>',
    text: [
      'Спасибо, что хотите поддержать развитие сервиса!',
      '',
      'Помощь позволит поддерживать справочники в актуальном состоянии и добавлять новые бесплатные функции.'
    ].join('\n')
  }
};

function menuKeyboard(env) {
  const app = env.MINI_APP_URL || 'https://4000680.github.io/grani_miniapp2/';
  return {
    inline_keyboard: [
      [{ text: '🧮 Рассчитать утильсбор', web_app: { url: app + 'tabs/utilsbor/index.html' } }],
      [{ text: '📅 Рассчитать пени', web_app: { url: app + 'tabs/utilsbor/index.html?mode=peni' } }],
      [{ text: '💳 Как оплатить утильсбор', callback_data: 'info:payment' }],
      [{ text: '📄 Оформить СБКТС', callback_data: 'info:sbkts' }],
      [{ text: '🔎 Найти ЭПТС по VIN', callback_data: 'info:epts' }],
      [{ text: '👤 Внести собственника в ЭПТС', callback_data: 'info:owner' }],
      [
        { text: '💬 Написать нам', callback_data: 'info:contact' },
        { text: '❤️ Поддержать проект', callback_data: 'info:donate' }
      ]
    ]
  };
}

function infoKeyboard(section, env) {
  const rows = [];
  const link = section === 'donate' ? env.DONATE_URL : env.CONTACT_URL;
  if (link && /^https:\/\//i.test(link)) {
    rows.push([{ text: section === 'donate' ? '❤️ Поддержать' : '💬 Написать специалисту', url: link }]);
  }
  rows.push([{ text: '‹ Вернуться в меню', callback_data: 'menu' }]);
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
  return telegram(env, 'editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: `${info.title}\n\n${info.text}`,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: infoKeyboard(section, env)
  });
}

async function handleUpdate(env, update) {
  if (update.message?.text) {
    const command = update.message.text.split(/\s+/)[0].split('@')[0].toLowerCase();
    if (command === '/start' || command === '/menu' || command === '/help') {
      await sendMenu(env, update.message.chat.id);
    }
    return;
  }

  const query = update.callback_query;
  if (!query) return;
  await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id });
  if (!query.message) return;
  if (query.data === 'menu') await editMenu(env, query.message);
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
      if (request.method === 'GET' && url.pathname.startsWith('/setup/')) return setupBot(request, env);
      if (request.method === 'GET' && url.pathname === '/') {
        return Response.json({ ok: true, service: 'grani-telegram-bot' });
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
