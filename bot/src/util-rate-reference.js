function formatMoney(value) {
  return `${Number(value).toLocaleString('ru-RU')} ₽`;
}

function ageLabel(age) {
  const label = age === 'new' ? 'до 3 лет' : 'старше 3 лет';
  return label[0].toUpperCase() + label.slice(1);
}

export function formatUtilYearReference(util, year, commercialOnly = false) {
  const lines = [`📅 Расчёт на ${year} год`, ''];
  for (const item of util) {
    const amount = item.commercial ?? item.amount;
    lines.push(ageLabel(item.age));
    if (commercialOnly || item.personal == null || item.personal === amount) {
      lines.push(`Утилизационный сбор: ${formatMoney(amount)}`);
      lines.push('Льготная ставка для личного пользования не применяется.');
    } else {
      lines.push(`Льготный утильсбор: ${formatMoney(item.personal)}`);
      lines.push(`Коммерческий утильсбор: ${formatMoney(amount)}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}
