const PERMANENT_RESULT_MARKERS = [
  '✅ Расчёт утильсбора',
  '✅ СБКТС распознан',
  '✅ Выписка ЭПТС распознана',
  '✅ Предварительный таможенный расчёт',
  '✅ Полный расчёт автомобиля до 3 лет',
  'Крайний срок уплаты:'
];

export function isPermanentResultText(text) {
  const value = String(text || '').trim();
  return PERMANENT_RESULT_MARKERS.some(marker => value.includes(marker));
}
