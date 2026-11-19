import { requestFts } from './fts.js';

const origins = new Set(['https://grani-br.ru', 'https://www.grani-br.ru']);
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;
const browserPattern = /^[a-f0-9]{32}$/;
const deviceLimit = 3;
const ipLimit = 12;
const siteLimit = 30;
const maxWaitMs = 23 * 60_000;
const requestTimeoutMs = 120_000;
const storageKey = 'website-fts-day';

function moscowDay(time) {
  return new Date(time + 3 * 3600_000).toISOString().slice(0, 10);
}

async function networkKey(secret, ip) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode('website-fts:' + ip));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readInput(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(body + decoder.decode());
      size += value.byteLength;
      if (size > 512) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function handleWebsiteFts(request, env) {
  const origin = request.headers.get('Origin');
  if (!origins.has(origin)) return new Response(null, { status: 403 });
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const respond = (data, status = 200) => Response.json(data, { status, headers });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    return respond({ code: 'INVALID_INPUT' }, 400);
  }
  const input = await readInput(request);
  if (typeof input?.vin !== 'string' || !vinPattern.test(input.vin) ||
      typeof input.browserId !== 'string' || !browserPattern.test(input.browserId)) {
    return respond({ code: 'INVALID_INPUT' }, 400);
  }
  const ip = request.headers.get('CF-Connecting-IP');
  if (!env.AVC_TOKEN || !env.APPLICATIONS || !ip) return respond({ code: 'UNAVAILABLE' }, 503);
  try {
    const ipKey = await networkKey(env.AVC_TOKEN, ip);
    const result = await env.APPLICATIONS.getByName('website-fts').checkWebsiteFts(input.vin, input.browserId, ipKey);
    const status = result.code?.endsWith('_LIMIT') ? 429 : result.code ? 503 : result.pending ? 202 : 200;
    return respond(result, status);
  } catch {
    return respond({ code: 'UNAVAILABLE' }, 503);
  }
}

function publicRecord(record) {
  const allowed = ['vin', 'model', 'releaseDate', 'body', 'chassis'];
  return Object.fromEntries(allowed
    .filter(field => typeof record[field] === 'string' && record[field].trim())
    .map(field => [field, record[field].slice(0, 300)]));
}

function waiting(ms) {
  return { pending: true, retryAfterSec: Math.max(3, Math.ceil(ms / 1000)) };
}

export async function checkWebsiteFts(storage, env, vin, browserId, ipKey,
  { now = Date.now, lookup = requestFts } = {}) {
  const day = moscowDay(now());
  const claim = await storage.transaction(async tx => {
    const time = now();
    let state = await tx.get(storageKey);
    if (state?.day !== day) state = { day, jobs: {}, browsers: {}, ips: {}, total: 0 };
    // Prefix user input before using it as an object key.
    const vinKey = 'vin:' + vin;
    const browserKey = 'browser:' + browserId;
    const ipSlot = 'ip:' + ipKey;
    const browser = state.browsers[browserKey] || [];
    if (!browser.includes(vinKey)) {
      if (browser.length >= deviceLimit) return { result: { code: 'DEVICE_LIMIT' } };
      if ((state.ips[ipSlot] || 0) >= ipLimit) return { result: { code: 'NETWORK_LIMIT' } };
      if (state.total >= siteLimit) return { result: { code: 'SITE_LIMIT' } };
      state.browsers[browserKey] = [...browser, vinKey];
      state.ips[ipSlot] = (state.ips[ipSlot] || 0) + 1;
      state.total += 1;
    }
    const current = state.jobs[vinKey];
    const saveResult = async result => {
      await tx.put(storageKey, state);
      return { result };
    };
    if (current?.result) return saveResult(current.result);
    if (current?.startedAt != null) {
      if (time - current.startedAt < requestTimeoutMs) return saveResult(waiting(3000));
      current.result = { code: 'UNCERTAIN' };
      return saveResult(current.result);
    }
    if (current?.nextAt > time) return saveResult(waiting(current.nextAt - time));
    if (current && time - current.createdAt >= maxWaitMs) {
      current.result = { code: 'UNCERTAIN' };
      return saveResult(current.result);
    }
    state.jobs[vinKey] = { createdAt: current?.createdAt ?? time, startedAt: time };
    await tx.put(storageKey, state);
    return { vinKey, time };
  });
  if (claim.result) return claim.result;

  const response = await lookup(env, { vin });
  return storage.transaction(async tx => {
    const state = await tx.get(storageKey);
    const job = state?.day === day ? state.jobs[claim.vinKey] : null;
    if (!job || job.startedAt !== claim.time) return { code: 'UNCERTAIN' };
    const time = now();
    let result;
    if (response.code === 'PROCESSING' && time - job.createdAt < maxWaitMs) {
      const delay = Math.min(120, Math.max(60, Number(response.retryAfterSec) || 60)) * 1000;
      const remaining = maxWaitMs - (time - job.createdAt);
      if (delay < remaining) {
        job.nextAt = time + delay;
        delete job.startedAt;
        result = waiting(delay);
      }
    } else if (!response.code && !response.testMode) {
      const records = response.records
        .filter(record => !record.vin || String(record.vin).replace(/\s/g, '').toUpperCase() === vin)
        .slice(0, 5).map(publicRecord);
      if (!response.found) result = { found: false, records: [] };
      else if (records.length) result = { found: true, records };
    }
    if (!result?.pending) job.result = result || { code: 'UNAVAILABLE' };
    await tx.put(storageKey, state);
    return result || job.result;
  });
}
