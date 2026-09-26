import { DurableObject } from 'cloudflare:workers';

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
