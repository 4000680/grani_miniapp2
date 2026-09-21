(function installSbktsPowerParser(globalScope) {
  const NUMBER_RE = /\d+(?:[.,]\d+)?/g;
  // В СБКТС иногда указывают техническое значение 0,0001 кВт вместо
  // отсутствующей 30-минутной мощности. Это не фактическая мощность.
  const MIN_MEANINGFUL_30_MIN_POWER_KW = 1;

  function normalizeLine(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[–—−]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function textLines(text) {
    return String(text || '')
      .replace(/\r/g, '\n')
      .split(/\n+/)
      .map(normalizeLine)
      .filter(Boolean);
  }

  function toNumber(value) {
    const number = Number(String(value).replace(',', '.'));
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function numbers(value) {
    return [...String(value || '').matchAll(NUMBER_RE)]
      .map(match => toNumber(match[0]))
      .filter(value => value !== null);
  }

  function withoutUnits(value) {
    return normalizeLine(value)
      .replace(/\(\s*мин\s*-?\s*1\s*\)/gi, ' ')
      .replace(/^[-:;,\s]+/, '')
      .replace(/^(?:мощность\s*,?\s*)?(?:квт)?\s*/i, '')
      .trim();
  }

  function firstPowerAfterLabel(lines, labelIndex, labelRegex, maxLookahead = 4) {
    const labelLine = lines[labelIndex] || '';
    const match = labelLine.match(labelRegex);
    const sameLineTail = match ? withoutUnits(labelLine.slice((match.index || 0) + match[0].length)) : '';
    const sameLineValue = numbers(sameLineTail)[0];
    if (sameLineValue !== undefined) return sameLineValue;

    for (let offset = 1; offset <= maxLookahead && labelIndex + offset < lines.length; offset++) {
      const line = withoutUnits(lines[labelIndex + offset]);
      if (!line || /^мощность\s*,?\s*квт$/i.test(line)) continue;
      if (/^[()\sа-яё-]*мин\s*-?\s*1[()\sа-яё-]*$/i.test(line)) continue;
      const value = numbers(line)[0];
      if (value !== undefined) return value;
      if (/^[а-яё]/i.test(line)) break;
    }
    return null;
  }

  function findSection(lines, startRegex, endRegex, fallbackLength = 45) {
    const start = lines.findIndex(line => startRegex.test(line));
    if (start < 0) return [];
    let end = lines.slice(start + 1).findIndex(line => endRegex.test(line));
    end = end < 0 ? Math.min(lines.length, start + fallbackLength) : start + 1 + end;
    return lines.slice(start, end);
  }

  function enginePowerCandidates(lines) {
    const section = findSection(
      lines,
      /двигател[ья]\s+внутреннего/i,
      /^(?:электромашин[аы]?\s*\(|электрическ\w*\s+двигател|подвеск|рулевое управление)/i
    );
    const source = section.length ? section : lines;
    const candidates = [];
    for (let index = 0; index < source.length; index++) {
      if (/30\s*-?\s*минутн/i.test(source[index])) continue;
      if (!/максимальная\s+мощность/i.test(source[index])) continue;
      const value = firstPowerAfterLabel(source, index, /максимальная\s+мощность(?:\s*,?\s*квт)?/i);
      if (value !== null) candidates.push(value);
    }
    return candidates;
  }

  function collectThirtyMinutePowers(lines) {
    const values = [];
    for (let index = 0; index < lines.length; index++) {
      const marker = lines[index].match(/максимальная\s+30\s*-?\s*минутная/i);
      if (!marker) continue;

      const tail = lines[index].slice((marker.index || 0) + marker[0].length);
      const inline = withoutUnits(tail);
      values.push(...numbers(inline));

      let sawContinuation = /мощность\s*,?\s*квт/i.test(tail);
      for (let offset = 1; offset <= 12 && index + offset < lines.length; offset++) {
        const line = lines[index + offset];
        if (/^мощность\s*,?\s*квт/i.test(line)) {
          sawContinuation = true;
          const afterUnits = line.replace(/^мощность\s*,?\s*квт/i, '');
          values.push(...numbers(afterUnits));
          continue;
        }
        if (/^\d+(?:[.,]\d+)?$/.test(line)) {
          values.push(toNumber(line));
          continue;
        }
        if (!sawContinuation && /^квт$/i.test(line)) {
          sawContinuation = true;
          continue;
        }
        break;
      }
    }
    return values.filter(value => value !== null);
  }

  function collectElectricMaximumPowers(lines) {
    const section = findSection(
      lines,
      /^(?:электромашин[аы]?\s*\(|электрическ\w*\s+двигател)/i,
      /подвеск|рулевое управление|тормозн|коробка передач/i,
      60
    );
    if (!section.length) return [];
    const values = [];
    for (let index = 0; index < section.length; index++) {
      const line = section[index];
      if (/30\s*-?\s*минутн/i.test(line) || !/максимальная\s+мощность/i.test(line)) continue;
      const marker = line.match(/максимальная\s+мощность(?:\s*,?\s*квт)?/i);
      if (!marker) continue;
      values.push(...numbers(withoutUnits(line.slice((marker.index || 0) + marker[0].length))));
      for (let offset = 1; offset <= 10 && index + offset < section.length; offset++) {
        const next = section[index + offset];
        if (/^\d+(?:[.,]\d+)?$/.test(next)) values.push(toNumber(next));
        else break;
      }
    }
    return values;
  }

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function parseSbktsPowerData(text) {
    const lines = textLines(text);
    const engineCandidates = enginePowerCandidates(lines);
    const distinctEngineCandidates = [...new Set(engineCandidates)];
    const electricMaxKw = collectElectricMaximumPowers(lines);
    const electric30MinKw = collectThirtyMinutePowers(lines)
      .map(value => value < MIN_MEANINGFUL_30_MIN_POWER_KW ? 0 : value);
    const ambiguousFields = distinctEngineCandidates.length > 1 ? ['engineMaxKw'] : [];

    return {
      engineMaxKw: distinctEngineCandidates.length === 1 ? distinctEngineCandidates[0] : null,
      engineMaxKwCandidates: engineCandidates,
      electricMaxKw,
      electric30MinKw,
      electric30MinKwTotal: electric30MinKw.length
        ? round2(electric30MinKw.reduce((sum, value) => sum + value, 0))
        : null,
      ambiguousFields
    };
  }

  globalScope.GraniSbktsPower = Object.freeze({
    parseSbktsPowerData,
    normalizeLine,
    textLines
  });
})(globalThis);
