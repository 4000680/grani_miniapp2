import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('автомобиль до 3 лет сначала выбирается по справочнику, затем вводятся объём и стоимость', () => {
  assert.match(source, /customs:under3:catalog/);
  assert.match(source, /stage: 'under3-selected-volume'/);
  assert.match(source, /stage: 'under3-selected-value'/);
  assert.ok(source.indexOf("stage: 'under3-selected-volume'") < source.indexOf("stage: 'under3-selected-value'"));
  assert.doesNotMatch(source, /Предварительный расчёт по стоимости/);
});

test('итог до 3 лет содержит объяснение ставки, оба утильсбора и дополнительные расходы', () => {
  assert.match(source, /Таможенный платёж по единой ставке/);
  assert.match(source, /Применён минимальный платёж за объём двигателя/);
  assert.match(source, /Льготный для личного пользования/);
  assert.match(source, /Коммерческий:/);
  assert.match(source, /услуги таможенного представителя/);
  assert.match(source, /• доставка;/);
  assert.match(source, /• СВХ;/);
  assert.match(source, /• лаборатория;/);
  assert.match(source, /• СБКТС и ЭПТС\./);
});
