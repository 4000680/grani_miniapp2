(function installCatalogMatch(globalScope) {
  const TRANSLIT = {
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
  };
  function normalize(value) { return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim(); }
  function transliterate(value) { return normalize(value).split('').map(char => TRANSLIT[char] ?? char).join(''); }
  function phonetic(value) {
    return transliterate(value)
      .replace(/ks/g, 'x')
      .replace(/ee/g, 'i')
      .replace(/iy|yi|y/g, 'i')
      .replace(/kh/g, 'h')
      .replace(/(.)\1+/g, '$1');
  }
  function tokens(value) { return transliterate(value).split(/\s+/).filter(Boolean); }
  function editDistance(leftValue, rightValue) {
    const left = String(leftValue || ''), right = String(rightValue || '');
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index), beforePrevious = null;
    for (let row = 1; row <= left.length; row++) {
      const current = [row];
      for (let column = 1; column <= right.length; column++) {
        const cost = left[row - 1] === right[column - 1] ? 0 : 1;
        let value = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + cost);
        if (beforePrevious && row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) value = Math.min(value, beforePrevious[column - 2] + cost);
        current[column] = value;
      }
      beforePrevious = previous; previous = current;
    }
    return previous[right.length];
  }
  function similarity(leftValue, rightValue) {
    const left = transliterate(leftValue).replace(/\s/g, ''), right = transliterate(rightValue).replace(/\s/g, '');
    if (!left || !right) return 0;
    if (left === right) return 1;
    const plain = Math.max(0, 1 - editDistance(left, right) / Math.max(left.length, right.length));
    const phoneticLeft = phonetic(left), phoneticRight = phonetic(right);
    const phoneticScore = Math.max(0, 1 - editDistance(phoneticLeft, phoneticRight) / Math.max(phoneticLeft.length, phoneticRight.length));
    return Math.max(plain, phoneticScore);
  }
  function tokenSimilarity(leftValue, rightValue) {
    const left = transliterate(leftValue).replace(/\s/g, ''), right = transliterate(rightValue).replace(/\s/g, '');
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (/^\d+$/.test(left) || /^\d+$/.test(right)) return 0;
    if (Math.min(left.length, right.length) >= 2 && (left.startsWith(right) || right.startsWith(left))) return 0.9;
    if (Math.min(left.length, right.length) >= 3 && (left.includes(right) || right.includes(left))) return 0.82;
    return similarity(left, right);
  }
  globalScope.GraniCatalogMatch = Object.freeze({ editDistance, normalize, phonetic, similarity, tokenSimilarity, tokens, transliterate });
})(globalThis);
