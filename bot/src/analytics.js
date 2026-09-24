const ISO_NOW = () => new Date().toISOString();

function getActor(update) {
  const message = update.message || update.callback_query?.message;
  const from = update.message?.from || update.callback_query?.from;
  if (!from?.id || message?.chat?.type !== 'private') return null;
  return { from, chatId: message.chat.id };
}

export function classify(update) {
  const message = update.message;
  if (message?.document) {
    const mime = String(message.document.mime_type || '').toLowerCase();
    return ['document', 'documents', mime.includes('pdf') ? 'pdf_upload' : 'document_upload'];
  }
  if (message?.text) {
    const command = message.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
    if (command === '/start') return ['entry', 'bot', 'start'];
    if (command === '/menu' || command === '/help') return ['navigation', 'bot', 'main_menu'];
    if (command === '/subscribe') return ['consent', 'marketing', 'subscribe'];
    if (command === '/unsubscribe') return ['consent', 'marketing', 'unsubscribe'];
    return ['message', 'bot', 'text'];
  }
  const data = String(update.callback_query?.data || '');
  if (!data) return null;
  if (data === 'menu') return ['navigation', 'menu', 'open'];
  if (data.startsWith('menu:util')) return ['section', 'util', 'open'];
  if (data.startsWith('menu:declaration')) return ['section', 'declaration', 'open'];
  if (data.startsWith('catalog:')) return ['section', 'sep_catalog', data.split(':').slice(1, 3).join('_')];
  if (data.startsWith('customs:')) return ['section', 'customs', data.split(':').slice(1, 3).join('_')];
  if (data.startsWith('declaration:')) return ['section', 'declaration', data.split(':').slice(1, 3).join('_')];
  if (data.startsWith('calc:peni:')) return ['calculation', 'penalties', 'calculate'];
  if (data.startsWith('calc:')) return ['interaction', 'util', data.split(':').slice(1, 3).join('_')];
  if (data === 'info:contact') return ['service_request', 'support', 'open'];
  if (data === 'info:epts') return ['service_request', 'epts', 'open'];
  if (data === 'info:sbkts') return ['service_request', 'sbkts', 'open'];
  if (data.startsWith('info:')) return ['section', 'info', data.slice(5, 50)];
  return ['interaction', 'bot', data.slice(0, 70)];
}

export async function trackUpdate(db, update) {
  if (!db) return;
  const actor = getActor(update);
  if (!actor) return;
  const { from } = actor;
  const now = ISO_NOW();
  const command = String(update.message?.text || '').trim().split(/\s+/)[0].split('@')[0].toLowerCase();
  const isStart = command === '/start';
  const existing = isStart
    ? await db.prepare('SELECT user_id FROM analytics_users WHERE user_id=?').bind(String(from.id)).first()
    : null;
  let event = classify(update);
  if (isStart) event = ['entry', 'bot', existing ? 'return' : 'first_start'];
  await db.prepare(`INSERT INTO analytics_users
    (user_id, username, first_name, last_name, language_code, first_seen_at, last_seen_at, chat_available)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name,
    last_name=excluded.last_name, language_code=excluded.language_code, last_seen_at=excluded.last_seen_at, chat_available=1`)
    .bind(String(from.id), from.username || null, from.first_name || null, from.last_name || null, from.language_code || null, now, now).run();
  if (event) {
    await db.prepare(`INSERT OR IGNORE INTO analytics_events (user_id, telegram_update_id, created_at, event_type, section, action, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(String(from.id), update.update_id == null ? null : String(update.update_id), now, event[0], event[1], event[2], JSON.stringify({ chatType: 'private' })).run();
  }
  const text = String(update.message?.text || '').trim().toLowerCase();
  const consentCommand = text.split(/\s+/)[0].split('@')[0];
  if (consentCommand === '/unsubscribe') {
    await db.prepare('UPDATE analytics_users SET marketing_consent=0, consent_updated_at=? WHERE user_id=?').bind(now, String(from.id)).run();
  } else if (consentCommand === '/subscribe') {
    await db.prepare('UPDATE analytics_users SET marketing_consent=1, consent_updated_at=? WHERE user_id=?').bind(now, String(from.id)).run();
  }
}

export async function analyticsOverview(db) {
  const row = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM analytics_users) total,
    (SELECT COUNT(*) FROM analytics_users WHERE first_seen_at >= strftime('%Y-%m-%dT00:00:00.000Z','now')) new_today,
    (SELECT COUNT(*) FROM analytics_users WHERE first_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')) new_7d,
    (SELECT COUNT(*) FROM analytics_users WHERE first_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')) new_30d,
    (SELECT COUNT(*) FROM analytics_users WHERE last_seen_at >= strftime('%Y-%m-%dT00:00:00.000Z','now')) active_today,
    (SELECT COUNT(*) FROM analytics_users WHERE last_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')) active_7d,
    (SELECT COUNT(*) FROM analytics_users WHERE last_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')) active_30d,
    (SELECT COUNT(*) FROM analytics_events WHERE event_type='calculation') calculations_total,
    (SELECT COUNT(*) FROM analytics_events WHERE event_type='calculation' AND created_at >= strftime('%Y-%m-%dT00:00:00.000Z','now')) calculations_today,
    (SELECT COUNT(*) FROM analytics_events WHERE event_type='calculation' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')) calculations_7d,
    (SELECT COUNT(*) FROM analytics_events WHERE event_type='calculation' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')) calculations_30d,
    ROUND((SELECT COUNT(*) FROM analytics_events WHERE event_type='calculation') * 1.0 /
      NULLIF((SELECT COUNT(*) FROM analytics_users WHERE last_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')),0), 2) avg_calculations_per_active`).first();
  const byFeature = await db.prepare(`SELECT section, COUNT(*) count FROM analytics_events WHERE event_type IN ('calculation','document','service_request') GROUP BY section ORDER BY count DESC`).all();
  return { ...row, byFeature: byFeature.results || [] };
}

export async function listAnalyticsUsers(db, { segment = 'all', offset = 0, query = '' } = {}) {
  const clauses = [];
  const binds = [];
  if (segment === 'new') clauses.push("u.first_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')");
  if (segment === 'today') clauses.push("u.last_seen_at >= strftime('%Y-%m-%dT00:00:00.000Z','now')");
  if (segment === 'active7') clauses.push("u.last_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')");
  if (segment.startsWith('inactive')) clauses.push(`u.last_seen_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-${Number(segment.slice(8)) || 14} days')`);
  if (segment.startsWith('calcs')) clauses.push(`(SELECT COUNT(*) FROM analytics_events e WHERE e.user_id=u.user_id AND e.event_type='calculation') >= ${Math.max(1, Number(segment.slice(5)) || 1)}`);
  if (segment === 'util') clauses.push("EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id=u.user_id AND e.section='util')");
  if (segment === 'customs') clauses.push("EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id=u.user_id AND e.section='customs')");
  if (segment === 'sbkts') clauses.push("EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id=u.user_id AND (e.section='sbkts' OR e.action LIKE '%sbkts%'))");
  if (segment === 'epts') clauses.push("EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id=u.user_id AND (e.section='epts' OR e.action LIKE '%epts%'))");
  if (segment === 'request_epts') clauses.push("EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id=u.user_id AND e.event_type='service_request' AND e.section='epts')");
  if (segment === 'request_sbkts') clauses.push("EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id=u.user_id AND e.event_type='service_request' AND e.section='sbkts')");
  if (query) { clauses.push('(u.user_id LIKE ? OR u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)'); const q = `%${query}%`; binds.push(q, q, q, q); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT u.user_id, u.username, u.first_name, u.last_name, u.first_seen_at, u.last_seen_at,
      (SELECT COUNT(*) FROM analytics_events e WHERE e.user_id=u.user_id) actions,
      (SELECT COUNT(*) FROM analytics_events e WHERE e.user_id=u.user_id AND e.event_type='calculation') calculations
    FROM analytics_users u ${where} ORDER BY u.last_seen_at DESC LIMIT 10 OFFSET ?`).bind(...binds, offset).all();
}

export async function getAnalyticsUser(db, userId) {
  return db.prepare(`SELECT u.*,
    (SELECT COUNT(*) FROM analytics_events e WHERE e.user_id=u.user_id) actions,
    (SELECT COUNT(*) FROM analytics_events e WHERE e.user_id=u.user_id AND e.event_type='calculation') calculations,
    (SELECT COUNT(DISTINCT substr(created_at,1,10)) FROM analytics_events e WHERE e.user_id=u.user_id) active_days
    FROM analytics_users u WHERE u.user_id=?`).bind(String(userId)).first();
}

export async function getAnalyticsHistory(db, userId, offset = 0) {
  return db.prepare('SELECT created_at,event_type,section,action FROM analytics_events WHERE user_id=? ORDER BY id DESC LIMIT 10 OFFSET ?').bind(String(userId), offset).all();
}

export async function listCampaigns(db) {
  return db.prepare(`SELECT id,audience,status,created_at,recipient_count,sent_count,error_count
    FROM analytics_campaigns ORDER BY id DESC LIMIT 10`).all();
}

export async function recordCompletedCalculation(db, userId, application) {
  if (!db || !userId) return;
  const source = String(application?.source || '').toLowerCase();
  const section = application?.calculationType === 'penalties' || source.includes('пени')
    ? 'penalties'
    : application?.calculationType === 'customs' || source.includes('тамож')
    ? 'customs'
    : application?.calculationType === 'declaration' || source.includes('деклара')
      ? 'declaration'
      : 'util';
  await db.prepare(`INSERT INTO analytics_events(user_id,created_at,event_type,section,action,metadata_json)
    VALUES(?,?,'calculation',?,'complete',?)`)
    .bind(String(userId), ISO_NOW(), section, JSON.stringify({ category: application?.category || null })).run();
}

export async function miniAppProfile(db, user) {
  if (!db || !user?.id) return null;
  const now = ISO_NOW();
  await db.prepare(`INSERT INTO analytics_users
    (user_id, username, first_name, last_name, language_code, first_seen_at, last_seen_at, chat_available)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name,
    last_name=excluded.last_name, language_code=excluded.language_code, last_seen_at=excluded.last_seen_at, chat_available=1`)
    .bind(String(user.id), user.username || null, user.first_name || null, user.last_name || null,
      user.language_code || null, now, now).run();
  const row = await db.prepare(`SELECT u.user_id, u.username, u.first_name, u.last_name, u.first_seen_at, u.last_seen_at,
      (SELECT COUNT(*) FROM analytics_events e WHERE e.user_id=u.user_id AND e.event_type='calculation') calculations_total,
      (SELECT COUNT(*) FROM analytics_events e WHERE e.user_id=u.user_id AND e.event_type='calculation'
        AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')) calculations_30d,
      (SELECT MAX(created_at) FROM analytics_events e WHERE e.user_id=u.user_id AND e.event_type='calculation') last_calculation_at
    FROM analytics_users u WHERE u.user_id=?`).bind(String(user.id)).first();
  const firstTime = Date.parse(row?.first_seen_at || now);
  return {
    userId: String(user.id), username: row?.username || user.username || null,
    firstName: row?.first_name || user.first_name || null,
    lastName: row?.last_name || user.last_name || null,
    firstSeenAt: row?.first_seen_at || now, lastSeenAt: row?.last_seen_at || now,
    daysUsing: Math.max(1, Math.floor((Date.now() - firstTime) / 86400000) + 1),
    calculationsTotal: Number(row?.calculations_total) || 0,
    calculations30d: Number(row?.calculations_30d) || 0,
    lastCalculationAt: row?.last_calculation_at || null,
    photoUrl: user.photo_url || null
  };
}

export async function recordDocumentType(db, userId, kind) {
  if (!db || !userId || !['sbkts', 'epts'].includes(kind)) return;
  await db.prepare(`INSERT INTO analytics_events(user_id,created_at,event_type,section,action,metadata_json)
    VALUES(?,?,'document',?,'parsed_upload','{}')`)
    .bind(String(userId), ISO_NOW(), kind).run();
}

export async function saveAdminSession(db, adminId, state) {
  await db.prepare(`INSERT INTO analytics_admin_sessions(admin_id,state_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(admin_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`)
    .bind(String(adminId), JSON.stringify(state), ISO_NOW()).run();
}

export async function getAdminSession(db, adminId) {
  const row = await db.prepare('SELECT state_json FROM analytics_admin_sessions WHERE admin_id=?').bind(String(adminId)).first();
  try { return row ? JSON.parse(row.state_json) : null; } catch { return null; }
}

export async function clearAdminSession(db, adminId) {
  await db.prepare('DELETE FROM analytics_admin_sessions WHERE admin_id=?').bind(String(adminId)).run();
}

export async function createCampaign(db, adminId, audience, messageText) {
  const insert = audience === 'all_consented'
    ? `INSERT INTO analytics_campaigns(created_by,audience,message_text,created_at,recipient_count) VALUES(?,?,?,?,(SELECT COUNT(*) FROM analytics_users WHERE marketing_consent=1 AND chat_available=1))`
    : `INSERT INTO analytics_campaigns(created_by,audience,message_text,created_at,recipient_count) VALUES(?,?,?,?,(SELECT COUNT(*) FROM analytics_users WHERE user_id=? AND chat_available=1))`;
  const binds = [String(adminId), audience, messageText, ISO_NOW()];
  if (audience !== 'all_consented') binds.push(String(adminId));
  const result = await db.prepare(insert).bind(...binds).run();
  const id = result.meta?.last_row_id;
  if (audience === 'all_consented') {
    await db.prepare(`INSERT INTO analytics_campaign_recipients(campaign_id,user_id)
      SELECT ?,user_id FROM analytics_users WHERE marketing_consent=1 AND chat_available=1`).bind(id).run();
  } else if (audience === 'admin_test') {
    await db.prepare('INSERT INTO analytics_campaign_recipients(campaign_id,user_id) VALUES(?,?)').bind(id, String(adminId)).run();
  }
  return { id, count: audience === 'all_consented' ? (await db.prepare('SELECT recipient_count FROM analytics_campaigns WHERE id=?').bind(id).first()).recipient_count : 1 };
}

export async function processCampaignBatch(db, sendMessage, logger = console) {
  const campaign = await db.prepare("SELECT id,message_text,audience FROM analytics_campaigns WHERE status IN ('queued','sending') ORDER BY id LIMIT 1").first();
  if (!campaign) return false;
  await db.prepare("UPDATE analytics_campaigns SET status='sending',started_at=COALESCE(started_at,?) WHERE id=?").bind(ISO_NOW(), campaign.id).run();
  if (campaign.audience === 'all_consented') {
    await db.prepare(`UPDATE analytics_campaign_recipients SET status='skipped'
      WHERE campaign_id=? AND status='queued' AND user_id IN
      (SELECT user_id FROM analytics_users WHERE marketing_consent=0 OR chat_available=0)`).bind(campaign.id).run();
  }
  const recipients = await db.prepare(`SELECT r.user_id FROM analytics_campaign_recipients r
    JOIN analytics_users u ON u.user_id=r.user_id
    WHERE r.campaign_id=? AND r.status='queued' AND u.chat_available=1
      AND (?='admin_test' OR u.marketing_consent=1) LIMIT 20`).bind(campaign.id, campaign.audience).all();
  for (const recipient of recipients.results || []) {
    try {
      await sendMessage(recipient.user_id, campaign.message_text);
      await db.prepare("UPDATE analytics_campaign_recipients SET status='sent',sent_at=? WHERE campaign_id=? AND user_id=?").bind(ISO_NOW(), campaign.id, recipient.user_id).run();
      await db.prepare('UPDATE analytics_campaigns SET sent_count=sent_count+1 WHERE id=?').bind(campaign.id).run();
    } catch (error) {
      const code = Number(error?.telegramCode || 0) === 403 ? '403' : String(error?.telegramCode || 'error').slice(0, 20);
      if (code === '429') {
        logger.warn('Analytics campaign paused by Telegram rate limit', campaign.id);
        break;
      }
      await db.prepare('UPDATE analytics_campaign_recipients SET status=\'error\',error_code=? WHERE campaign_id=? AND user_id=?').bind(code, campaign.id, recipient.user_id).run();
      await db.prepare('UPDATE analytics_campaigns SET error_count=error_count+1 WHERE id=?').bind(campaign.id).run();
      if (code === '403') await db.prepare('UPDATE analytics_users SET chat_available=0 WHERE user_id=?').bind(recipient.user_id).run();
      logger.error('Analytics campaign delivery failed', campaign.id, recipient.user_id, code);
    }
  }
  const remaining = await db.prepare("SELECT COUNT(*) count FROM analytics_campaign_recipients WHERE campaign_id=? AND status='queued'").bind(campaign.id).first();
  if (!remaining?.count) await db.prepare("UPDATE analytics_campaigns SET status='finished',finished_at=? WHERE id=?").bind(ISO_NOW(), campaign.id).run();
  return Boolean(recipients.results?.length);
}
