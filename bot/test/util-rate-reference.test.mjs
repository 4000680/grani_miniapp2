import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUtilYearReference } from '../src/util-rate-reference.js';

test('формирует короткую справку по коммерческому утильсбору за 2027 год', () => {
  assert.equal(
    formatUtilYearReference([{ age: 'new', commercial: 3521800, personal: 3521800 }], 2027),
    '📅 Расчёт на 2027 год\n\nДо 3 лет\nУтилизационный сбор: 3\u00a0521\u00a0800 ₽\nЛьготная ставка для личного пользования не применяется.'
  );
});

test('показывает личную и коммерческую ставки, если они различаются', () => {
  assert.equal(
    formatUtilYearReference([{ age: 'old', commercial: 1000000, personal: 3400 }], 2027),
    '📅 Расчёт на 2027 год\n\nСтарше 3 лет\nЛьготный утильсбор: 3\u00a0400 ₽\nКоммерческий утильсбор: 1\u00a0000\u00a0000 ₽'
  );
});
