function positivePower(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundPower(value) {
  return Math.round(value * 100) / 100;
}

export function electricCustomsPowerDetails(candidate) {
  const combustionKw = positivePower(candidate?.combustionKw);
  const electricKw = positivePower(candidate?.electricKw);
  if (!electricKw) {
    throw new Error('В шаблоне СЭП не найдена 30-минутная мощность выбранного автомобиля');
  }
  return {
    vehicleType: combustionKw ? 'последовательный гибрид' : 'электромобиль',
    combustionKw: roundPower(combustionKw),
    electricKw: roundPower(electricKw),
    excisePowerKw: roundPower(combustionKw + electricKw),
    utilPowerKw: roundPower(electricKw)
  };
}
