import { monitorBotOperation } from './bot-monitoring.js';
import { DurableObject } from 'cloudflare:workers';
import { subscribeFts, runFtsAlarm } from './fts.js';
import { checkWebsiteFts } from './fts-website.js';

const MAX_APPLICATIONS = 20;

function cleanText(value, max = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeApplication(input) {
  const item = {
    id: cleanText(input.id, 80) || crypto.randomUUID(),
    createdAt: /^\d{4}-\d{2}-\d{2}T/.test(input.createdAt || '') ? input.createdAt : new Date().toISOString(),
    source: cleanText(input.source, 30),
    vin: cleanText(input.vin, 24).toUpperCase(),
    surname: cleanText(input.surname, 60),
    brand: cleanText(input.brand, 60),
    model: cleanText(input.model, 80),
    year: Number(input.year) || null,
    category: cleanText(input.category, 12).toUpperCase(),
    kw: Number(input.kw) || null,
    ccm: Number(input.ccm) || null,
    calculationType: cleanText(input.calculationType, 20),
    customsValue: Number(input.customsValue) || null,
    customsDuty: Number(input.customsDuty) || null,
    customsFee: Number(input.customsFee) || null,
    utilAmount: Number(input.utilAmount) || null,
    amount: Number(input.amount) || null,
    amountLabel: cleanText(input.amountLabel, 80),
    resultText: String(input.resultText || '').slice(0, 16384),
    parseMode: input.parseMode === 'HTML' ? 'HTML' : null
  };
  return item;
}

export class ApplicationsStore extends DurableObject {
  geocodeQueue = Promise.resolve();

  async saveContractDraft(draft) {
    const storage = this.ctx.storage;
    await storage.transaction(async tx => {
      const expiresAt = Date.now() + 30 * 60000;
      await tx.put('contract-draft', { ...draft, expiresAt });
      await tx.setAlarm(expiresAt);
    });
  }

  async getContractDraft() {
    const draft = await this.ctx.storage.get('contract-draft');
    return draft?.expiresAt > Date.now() ? draft : null;
  }

  async updateContractDraft(draft) {
    await this.ctx.storage.transaction(async tx => {
      const current = await tx.get('contract-draft');
      if (current?.id === draft.id && current.expiresAt > Date.now()) {
        await tx.put('contract-draft', { ...draft, messageIds: [...new Set([...(current.messageIds || []), draft.preview].filter(Boolean))], expiresAt: current.expiresAt });
      }
    });
  }

  async trackContractMessage(id, messageId) {
    return this.ctx.storage.transaction(async tx => {
      const draft = await tx.get('contract-draft');
      if (draft?.id !== id || draft.expiresAt <= Date.now()) return false;
      await tx.put('contract-draft', { ...draft, messageIds: [...new Set([...(draft.messageIds || []), messageId])] });
      return true;
    });
  }

  async claimContractDraft(id, expectedStage, stage) {
    return this.ctx.storage.transaction(async tx => {
      const current = await tx.get('contract-draft');
      if (current?.id !== id || current.stage !== expectedStage || current.expiresAt <= Date.now()) return false;
      await tx.put('contract-draft', { ...current, stage });
      return true;
    });
  }

  async clearContractDraft(id) {
    return this.ctx.storage.transaction(async tx => {
      const current = await tx.get('contract-draft');
      if (!current || (id && id !== current.id)) return null;
      await tx.delete('contract-draft');
      return current;
    });
  }

  async saveFtsContext(context) {
    const id = crypto.randomUUID();
    await this.ctx.storage.transaction(async tx => {
      const items = (await tx.get('fts-contexts')) || [];
      await tx.put('fts-contexts', [{ ...context, id }, ...items].slice(0, 30));
    });
    return id;
  }

  async getFtsContext(id) {
    return ((await this.ctx.storage.get('fts-contexts')) || [])
      .find(item => item.id === id && Date.now() - item.createdAt < 30 * 86400000) || null;
  }

  async subscribeFts(input) {
    return subscribeFts(this.ctx.storage, this.env, input);
  }

  async checkWebsiteFts(vin, browserId, ipKey) {
    return checkWebsiteFts(this.ctx.storage, this.env, vin, browserId, ipKey);
  }

  async alarm() {
    const contract = await this.ctx.storage.get('contract-draft');
    if (contract) {
      if (contract.expiresAt <= Date.now()) await this.clearContractDraft(contract.id);
      else await this.ctx.storage.setAlarm(contract.expiresAt);
      return;
    }
    const send = async (env, method, data) => {
      const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        signal: AbortSignal.timeout(10000), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(`FTS delivery failed: ${result.description || response.status}`);
      return result.result;
    };
    const job = await this.ctx.storage.get('fts-job');
    await monitorBotOperation(this.env, { section: 'fts', stage: 'проверка ФТС', code: 'FTS_ALARM_ERROR',
      userId: Object.values(job?.subscribers || {})[0]?.userId, maxMs: 180000 },
      () => runFtsAlarm(this.ctx.storage, this.env, send));
  }

  async geocodePlace(query, endpoint = 'https://nominatim.openstreetmap.org/search') {
    const normalized = cleanText(query, 100).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
    if (!normalized) return null;
    const run = this.geocodeQueue.then(async () => {
      const cacheKey = `place:${normalized}`;
      const cached = await this.ctx.storage.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.result;
      const nextAt = Number(await this.ctx.storage.get('geocode-next-at')) || 0;
      const waitMs = Math.max(0, nextAt - Date.now());
      await this.ctx.storage.put('geocode-next-at', Date.now() + Math.max(waitMs, 0) + 1100);
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      const url = new URL(endpoint);
      url.search = new URLSearchParams({
        q: `${cleanText(query, 100)}, Россия`, format: 'jsonv2', limit: '1',
        addressdetails: '1', countrycodes: 'ru', 'accept-language': 'ru'
      });
      const response = await fetch(url, {
        headers: { 'User-Agent': 'BrokerGraniOrganizationCatalog/1.0 (+https://t.me/grani_broker)' }
      });
      if (!response.ok) throw new Error(`Geocoder returned HTTP ${response.status}`);
      const matches = await response.json();
      const match = Array.isArray(matches) ? matches[0] : null;
      const result = match && Number.isFinite(Number(match.lat)) && Number.isFinite(Number(match.lon))
        ? { lat: Number(match.lat), lon: Number(match.lon), displayName: match.display_name || '', addresstype: match.addresstype || '' }
        : null;
      await this.ctx.storage.put(cacheKey, { result, expiresAt: Date.now() + (result ? 30 : 1) * 86400000 });
      return result;
    });
    this.geocodeQueue = run.catch(() => null);
    return run;
  }

  async list() {
    return (await this.ctx.storage.get('items')) || [];
  }

  async add(input) {
    const item = normalizeApplication(input);
    const items = await this.list();
    const next = [item, ...items.filter(existing => existing.id !== item.id)].slice(0, MAX_APPLICATIONS);
    await this.ctx.storage.put('items', next);
    const now = new Date().toISOString();
    const profile = await this.getProfile();
    const dateLimit = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentDates = (profile.calculationDates || []).filter(value => Date.parse(value) >= dateLimit);
    recentDates.push(item.createdAt);
    await this.ctx.storage.put('profile', {
      ...profile,
      calculationCount: (Number(profile.calculationCount) || items.length) + 1,
      calculationDates: recentDates,
      lastCalculationAt: item.createdAt,
      lastSeenAt: now
    });
    return next;
  }

  async touchProfile(user = {}) {
    const now = new Date().toISOString();
    const profile = await this.getProfile();
    const next = {
      ...profile,
      userId: String(user.id || profile.userId || ''),
      username: cleanText(user.username || profile.username, 64),
      firstName: cleanText(user.first_name || profile.firstName, 100),
      lastName: cleanText(user.last_name || profile.lastName, 100),
      languageCode: cleanText(user.language_code || profile.languageCode, 12),
      photoUrl: cleanText(user.photo_url || profile.photoUrl, 512),
      firstSeenAt: profile.firstSeenAt || now,
      lastSeenAt: now,
      calculationCount: Number(profile.calculationCount) || (await this.list()).length,
      calculationDates: Array.isArray(profile.calculationDates) ? profile.calculationDates : []
    };
    await this.ctx.storage.put('profile', next);
    return next;
  }

  async getProfile() {
    return (await this.ctx.storage.get('profile')) || {};
  }

  async getCalculation(id) {
    return (await this.list()).find(item => item.id === String(id)) || null;
  }

  async clear() {
    await this.ctx.storage.delete('items');
    return [];
  }

  async getCustomsState() {
    return (await this.ctx.storage.get('customs-state')) || null;
  }

  async setCustomsState(state) {
    await this.ctx.storage.put('customs-state', state);
    return state;
  }

  async clearCustomsState() {
    await this.ctx.storage.delete('customs-state');
  }

  async openBlueInkUpload(promptId) {
    return this.ctx.storage.transaction(async tx => {
      const previous = await tx.get('blue-ink-prompt');
      if (!previous || previous.promptId < promptId) {
        await tx.put('blue-ink-prompt', { promptId, expires: Date.now() + 10 * 60 * 1000 });
        return previous?.promptId;
      }
      return promptId;
    });
  }

  async claimBlueInkUpload(messageId) {
    return this.ctx.storage.transaction(async tx => {
      const previous = await tx.get('blue-ink-last-input');
      if (previous && previous.messageId >= messageId && previous.expires > Date.now()) return 'duplicate';
      const prompt = await tx.get('blue-ink-prompt');
      if (!prompt || prompt.promptId >= messageId || prompt.expires <= Date.now()) return null;
      await tx.delete('blue-ink-prompt');
      await tx.put('blue-ink-last-input', { messageId, expires: Date.now() + 10 * 60 * 1000 });
      return prompt;
    });
  }

  async cancelBlueInkUpload() {
    const prompt = await this.ctx.storage.get('blue-ink-prompt');
    await this.ctx.storage.delete('blue-ink-prompt');
    return prompt?.promptId;
  }

  async getMessageFlowState() {
    return (await this.ctx.storage.get('message-flow-state')) || null;
  }

  async setMessageFlowState(state) {
    await this.ctx.storage.put('message-flow-state', state);
    return state;
  }

  async clearMessageFlowState() {
    await this.ctx.storage.delete('message-flow-state');
  }

  async getOrganizationCatalogState() {
    return (await this.ctx.storage.get('organization-catalog-state')) || null;
  }

  async setOrganizationCatalogState(state) {
    await this.ctx.storage.put('organization-catalog-state', state);
    return state;
  }

  async clearOrganizationCatalogState() {
    await this.ctx.storage.delete('organization-catalog-state');
  }
}
