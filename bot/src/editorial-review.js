const DRAFT_CAPTION = 'Льготный утильсбор · HTML-превью сайта на согласование';
const DRAFT_FILE = 'lgotnyy-utilsbor-2026.html';
const APPROVALS = new Set(['одобряю', 'согласовано', 'одобряю, публикуй']);

export function isEditorialReply(env, message) {
  const reply = message?.reply_to_message;
  const admin = String(env.EDITORIAL_REVIEW_ADMIN_ID || env.ADMIN_ID || env.ADMIN_TELEGRAM_ID || '');
  return Boolean(admin && env.BOT_TOKEN && message?.chat?.type === 'private'
    && String(message.chat.id) === admin && String(message.from?.id) === admin
    && reply?.from?.is_bot && String(reply.from.id) === env.BOT_TOKEN.split(':')[0]
    && reply?.document?.file_name === DRAFT_FILE && reply?.caption?.startsWith(DRAFT_CAPTION));
}

export function isEditorialApproval(value) {
  return APPROVALS.has(value.trim().toLowerCase().replace(/[.!]+$/, '').trim());
}

const BLOCK = /<(h1|h2|p)(?: [^>]*)?>[^<>]+<\/\1>/gu;
const escapeText = (str) => str.replace(/[&<>"']/g, (symbol) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[symbol]);

export function editorialTextBlocks(page) {
  return Array.from(page.matchAll(BLOCK), ([full]) => full.replace(/^[^>]*>|<\/[^>]+>$/gu, ''));
}

export function applyEditorialChanges(page, changes) {
  if (!Array.isArray(changes) || !changes.length) throw new Error('empty changes');
  const blocks = editorialTextBlocks(page);
  const replacements = new Map();
  for (const { index, text } of changes) {
    if (!Number.isInteger(index) || index < 0 || index >= blocks.length || replacements.has(index)
        || typeof text !== 'string' || !text.trim() || text.length > 5000) throw new Error('invalid change');
    replacements.set(index, escapeText(text.trim()));
  }
  let index = 0;
  return page.replace(BLOCK, (fragment) => {
    const replacement = replacements.get(index++);
    return replacement === undefined ? fragment
      : fragment.slice(0, fragment.indexOf('>') + 1) + replacement + fragment.slice(fragment.lastIndexOf('<'));
  });
}

async function loadTelegramFile(env, telegram, fileId, limit) {
  const file = await telegram(env, 'getFile', { file_id: fileId });
  if (!file?.file_path || file.file_size > limit) throw new Error('file unavailable');
  const path = file.file_path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch('https://api.telegram.org/file/bot' + env.BOT_TOKEN + '/' + path, {
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error('download failed');
  const blob = await response.blob();
  if (blob.size > limit) throw new Error('file too large');
  return blob;
}

async function groq(env, endpoint, body) {
  if (!env.GROQ_API_KEY) throw new Error('Groq not configured');
  const headers = { Authorization: 'Bearer ' + env.GROQ_API_KEY };
  if (!(body instanceof FormData)) headers['content-type'] = 'application/json';
  const response = await fetch('https://api.groq.com/openai/v1/' + endpoint, {
    method: 'POST', headers, body: body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(9500),
  });
  if (!response.ok) throw new Error('Groq request failed');
  return response.json();
}

export async function handleEditorialReply(env, message, telegram) {
  if (!isEditorialReply(env, message)) return false;
  const db = env.ANALYTICS_DB;
  const chatId = message.chat.id;
  const parent = message.reply_to_message;
  const notify = (text) => telegram(env, 'sendMessage', {
    chat_id: chatId, text, reply_parameters: { message_id: message.message_id },
  });
  let claimed = false;
  let revisionSent = false;
  try {
    if (!db) throw new Error('D1 not configured');
    const text = String(message.text || '').trim();
    if (!text && !message.voice) {
      await notify('Пришли правки текстом или голосом. Для согласования ответь «Одобряю».');
      return true;
    }
    await db.prepare('CREATE TABLE IF NOT EXISTS editorial_reviews (chat_id TEXT, parent_id INTEGER, source_file TEXT NOT NULL, status TEXT NOT NULL, reply_id INTEGER, PRIMARY KEY (chat_id, parent_id))').run();
    const stored = await db.prepare('INSERT OR IGNORE INTO editorial_reviews VALUES (?, ?, ?, ?, NULL)')
      .bind(String(chatId), parent.message_id, parent.document.file_id, 'processing').run();
    if (!stored.meta.changes) {
      const row = await db.prepare('SELECT status FROM editorial_reviews WHERE chat_id = ? AND parent_id = ?')
        .bind(String(chatId), parent.message_id).first();
      await notify(row?.status === 'approved' ? 'Эта версия уже согласована.'
        : row?.status === 'revised' ? 'У этой статьи есть новая версия. Ответь на последнее HTML-превью.'
        : 'Этот ответ уже обрабатывается.');
      return true;
    }
    claimed = true;
    const setStatus = (status, replyId = null) => db.prepare(
      'UPDATE editorial_reviews SET status = ?, reply_id = ? WHERE chat_id = ? AND parent_id = ?'
    ).bind(status, replyId, String(chatId), parent.message_id).run();
    if (!message.voice && isEditorialApproval(text)) {
      await setStatus('approved', message.message_id);
      claimed = false;
      await notify('Согласование этой HTML-версии сохранено. Публикация из бота пока не подключена.');
      return true;
    }
    let instructions = text;
    if (message.voice) {
      const sound = await loadTelegramFile(env, telegram, message.voice.file_id, 10 * 1024 * 1024);
      const form = new FormData();
      form.set('file', sound, 'review.ogg');
      form.set('model', 'whisper-large-v3-turbo');
      form.set('language', 'ru');
      instructions = (await groq(env, 'audio/transcriptions', form)).text?.trim();
    }
    if (!instructions || (message.voice && isEditorialApproval(instructions))) {
      await db.prepare('DELETE FROM editorial_reviews WHERE chat_id = ? AND parent_id = ? AND status = ?')
        .bind(String(chatId), parent.message_id, 'processing').run();
      claimed = false;
      await notify('Для согласования ответь на HTML-превью текстом «Одобряю». Правки можно прислать голосом.');
      return true;
    }
    const page = await (await loadTelegramFile(env, telegram, parent.document.file_id, 256 * 1024)).text();
    const blocks = editorialTextBlocks(page);
    if (!blocks.length) throw new Error('no article text');
    const result = await groq(env, 'chat/completions', {
      model: 'openai/gpt-oss-120b', response_format: { type: 'json_object' },
      max_completion_tokens: 3500,
      messages: [
        { role: 'system', content: 'Русский редактор. Правь только предоставленный текст. Не добавляй непроверенные ставки, даты, правовые условия и источники. Если правка требует новых фактов или ответ не содержит понятной правки, верни {"clarification":"вопрос редактору"}. Иначе верни {"changes":[{"index":0,"text":"новый текст"}]} только для изменённых блоков. Индексы с нуля. Без HTML.' },
        { role: 'user', content: JSON.stringify({ instructions, blocks }) },
      ],
    });
    const edits = JSON.parse(result.choices[0].message.content);
    if (typeof edits.clarification === 'string' && edits.clarification.trim()) {
      await db.prepare('DELETE FROM editorial_reviews WHERE chat_id = ? AND parent_id = ? AND status = ?')
        .bind(String(chatId), parent.message_id, 'processing').run();
      claimed = false;
      await notify(edits.clarification.trim().slice(0, 2000) + '\nОтветь на исходное HTML-превью.');
      return true;
    }
    const updated = applyEditorialChanges(page, edits.changes);
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', DRAFT_CAPTION + '. Ответь текстом или голосом с правками либо напиши «Одобряю».');
    form.set('document', new Blob([updated], { type: 'text/html' }), DRAFT_FILE);
    const sent = await telegram(env, 'sendDocument', form);
    revisionSent = true;
    await setStatus('revised', sent.message_id);
  } catch {
    if (claimed && !revisionSent) {
      await db.prepare('DELETE FROM editorial_reviews WHERE chat_id = ? AND parent_id = ? AND status = ?')
        .bind(String(chatId), parent.message_id, 'processing').run().catch(() => {});
    }
    await notify('Не удалось завершить обработку редакционного ответа. Проверь, пришло ли новое превью, или повтори ответ.');
  }
  return true;
}
