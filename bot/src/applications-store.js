import { DurableObject } from 'cloudflare:workers';

const MAX_APPLICATIONS = 10;

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
    amountLabel: cleanText(input.amountLabel, 80)
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
    return next;
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
}
