(function installVehiclePower(globalScope) {
  const round2 = value => Math.round(Number(value) * 100) / 100;

  function normalizePowertrainText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sourceExcerpt(text) {
    const normalized = normalizePowertrainText(text);
    const match = normalized.match(/[^.\n]{0,100}(?:параллел\w*|последовательн\w*|гибрид\w*|электромобил\w*)[^.\n]{0,100}/i);
    return match ? match[0].trim() : null;
  }

  function classifyPowertrain(text, values = {}) {
    const normalized = normalizePowertrainText(text);
    const engineKw = Number(values.engineKw) || 0;
    const electric30MinKw = Number(values.electric30MinKw) || 0;
    const hasParallel = /параллел\w*/i.test(normalized);
    const hasSeries = /последовательн\w*/i.test(normalized);
    const hasHybrid = /гибрид\w*|комбинированн\w*\s+энергоустанов/i.test(normalized);
    const hasEv = /электромобил\w*|только\s+электрическ\w*\s+(?:двигател|машин)/i.test(normalized);

    let hybridType = null;
    if (hasParallel && hasSeries) {
      const parallelFirst = normalized.search(/параллел\w*/i) <= normalized.search(/последовательн\w*/i);
      hybridType = parallelFirst ? 'parallel-series' : 'series-parallel';
    } else if (hasParallel) {
      hybridType = 'parallel';
    } else if (hasSeries) {
      hybridType = 'series';
    } else if (hasEv || (electric30MinKw > 0 && engineKw === 0 && !hasHybrid)) {
      hybridType = 'ev';
    } else if (hasHybrid || (electric30MinKw > 0 && engineKw > 0)) {
      hybridType = 'unknown-hybrid';
    } else if (engineKw > 0) {
      hybridType = 'combustion';
    }

    return { hybridType, hybridTypeSource: sourceExcerpt(text) };
  }

  function calculateVehiclePower(values = {}) {
    const engineKw = Number(values.engineKw) || 0;
    const electric30MinKw = Number(values.electric30MinKw) || 0;
    const hasExplicitZero30MinPower = values.electric30MinKwSpecified === true && electric30MinKw === 0;
    const hybridType = values.hybridType || null;
    let calculatedKw = null;
    let error = null;
    let errorCode = null;

    if (['parallel', 'parallel-series', 'series-parallel'].includes(hybridType)) {
      if (!engineKw) {
        errorCode = 'ENGINE_POWER_NOT_DETECTED';
        error = 'Не удалось определить максимальную мощность ДВС';
      } else if (!electric30MinKw && !hasExplicitZero30MinPower) {
        errorCode = 'ELECTRIC_30MIN_POWER_NOT_DETECTED';
        error = 'Не удалось определить 30-минутную мощность электромашины';
      }
      else calculatedKw = round2(engineKw + electric30MinKw);
    } else if (hybridType === 'series' || hybridType === 'ev') {
      if (!electric30MinKw) {
        errorCode = 'ELECTRIC_30MIN_POWER_NOT_DETECTED';
        error = 'Не удалось определить 30-минутную мощность электромашины';
      }
      else calculatedKw = round2(electric30MinKw);
    } else if (hybridType === 'combustion') {
      if (!engineKw) {
        errorCode = 'ENGINE_POWER_NOT_DETECTED';
        error = 'Не удалось определить мощность двигателя';
      }
      else calculatedKw = round2(engineKw);
    } else if (hybridType === 'unknown-hybrid') {
      errorCode = 'HYBRID_TYPE_NOT_DETECTED';
      error = 'Тип силовой установки требует уточнения: в СБКТС не удалось надёжно определить параллельную или последовательную схему';
    } else {
      errorCode = 'HYBRID_TYPE_NOT_DETECTED';
      error = 'Не удалось определить тип силовой установки';
    }

    return { engineKw: engineKw || null, electric30MinKw: electric30MinKw || null, calculatedKw, hybridType, error, errorCode };
  }

  function analyzeVehiclePower(text, values = {}) {
    const classification = classifyPowertrain(text, values);
    return {
      ...classification,
      ...calculateVehiclePower({ ...values, hybridType: classification.hybridType })
    };
  }

  function hybridTypeLabel(type) {
    return ({
      parallel: 'параллельный',
      'parallel-series': 'параллельно-последовательный',
      'series-parallel': 'последовательно-параллельный',
      series: 'последовательный',
      ev: 'электромобиль',
      combustion: 'ДВС',
      'unknown-hybrid': 'тип требует уточнения'
    })[type] || String(type || 'не определён');
  }

  globalScope.GraniVehiclePower = Object.freeze({
    analyzeVehiclePower,
    calculateVehiclePower,
    classifyPowertrain,
    hybridTypeLabel,
    normalizePowertrainText
  });
})(globalThis);
