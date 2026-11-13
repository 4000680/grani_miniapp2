const initialized = new WeakMap();
const validId = value => /^[1-9]\d{0,15}$/.test(String(value || ''));

async function ensureSchema(db) {
  if (!initialized.has(db)) {
    const ready = db.prepare(`CREATE TABLE IF NOT EXISTS signature_access (
      user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
    )`).run().catch(error => { initialized.delete(db); throw error; });
    initialized.set(db, ready);
  }
  return initialized.get(db);
}

export async function canCheckSignature(env, userId) {
  if (!validId(userId)) return false;
  const adminId = String(env.ADMIN_ID || env.ADMIN_TELEGRAM_ID || '');
  if (!env.ANALYTICS_DB) return String(userId) === adminId;
  try {
    await ensureSchema(env.ANALYTICS_DB);
    const row = await env.ANALYTICS_DB.prepare('SELECT enabled FROM signature_access WHERE user_id=?').bind(String(userId)).first();
    return row ? row.enabled === 1 : String(userId) === adminId;
  } catch {
    // A storage failure must never grant access or prevent the usual calculation.
    return false;
  }
}

export async function setSignatureAccess(env, actorId, userId, enabled) {
  const adminId = String(env.ADMIN_ID || env.ADMIN_TELEGRAM_ID || '');
  if (!adminId || String(actorId) !== adminId) throw new Error('Нет доступа');
  if (!validId(userId) || typeof enabled !== 'boolean') throw new Error('Некорректные параметры доступа');
  if (!env.ANALYTICS_DB) throw new Error('База доступа недоступна');
  await ensureSchema(env.ANALYTICS_DB);
  // Explicit desired state makes duplicate Telegram callbacks idempotent.
  await env.ANALYTICS_DB.prepare(`INSERT INTO signature_access(user_id,enabled,updated_by,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(String(userId), enabled ? 1 : 0, adminId, new Date().toISOString()).run();
}

export async function filterSignatureState(env, userId, state) {
  const vehicles = [state?.vehicle, state?.utilYearContext?.vehicle].filter(Boolean);
  if (vehicles.some(vehicle => vehicle.signatureCheck) && !await canCheckSignature(env, userId)) {
    for (const vehicle of vehicles) delete vehicle.signatureCheck;
  }
  return state;
}
