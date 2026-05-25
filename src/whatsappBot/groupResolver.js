const assert = require('assert');

function normalizeText(value = '') {
  return String(value ?? '')
    .replace(/[_\.\-]+/g, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractKeyword(cpName = '') {
  const raw = String(cpName ?? '').trim();
  if (!raw) {
    return '';
  }

  const withoutPrefix = raw.replace(/^cp[_\s-]+/i, '');
  return normalizeText(withoutPrefix);
}

function normalizeGroupName(groupName = '') {
  return normalizeText(groupName);
}

function splitKeywordWords(keyword = '') {
  return keyword.split(' ').map((segment) => segment.trim()).filter(Boolean);
}

function pickBestMatch(matches = [], keyword = '') {
  const keywordWords = splitKeywordWords(keyword);

  return matches
    .map((item) => {
      const normalizedName = normalizeGroupName(item.name);
      const matchedWords = keywordWords.filter((word) => normalizedName.includes(word)).length;
      const score = keywordWords.length ? matchedWords / keywordWords.length : 0;
      return {
        group: item,
        normalizedName,
        score,
        length: normalizedName.length
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.length !== right.length) {
        return left.length - right.length;
      }
      return String(left.group.name).localeCompare(String(right.group.name));
    })[0];
}

function resolveGroupByCP(cpName, allGroups = []) {
  const keyword = extractKeyword(cpName);
  const groups = Array.isArray(allGroups) ? allGroups.filter(Boolean) : [];

  if (!keyword) {
    return {
      found: false,
      reason: 'NO_GROUP_FOUND',
      cpName,
      keyword,
      strategy: 'NONE'
    };
  }

  const normalizedGroups = groups.map((group) => ({
    group,
    normalizedName: normalizeGroupName(group.name)
  }));

  let results = normalizedGroups.filter((item) => item.normalizedName.includes(keyword));
  let strategy = 'A';

  if (!results.length) {
    const keywordWords = splitKeywordWords(keyword);
    results = keywordWords.length
      ? normalizedGroups.filter((item) => keywordWords.every((word) => item.normalizedName.includes(word)))
      : [];
    strategy = 'B';
  }

  if (!results.length) {
    const longestWord = splitKeywordWords(keyword).sort((left, right) => right.length - left.length)[0];
    results = longestWord
      ? normalizedGroups.filter((item) => item.normalizedName.includes(longestWord))
      : [];
    strategy = 'C';
  }

  if (!results.length) {
    return {
      found: false,
      reason: 'NO_GROUP_FOUND',
      cpName,
      keyword,
      strategy
    };
  }

  if (results.length === 1) {
    return {
      found: true,
      group: results[0].group,
      keyword,
      strategy,
      ambiguous: false,
      allMatches: [results[0].group]
    };
  }

  const best = pickBestMatch(results.map((item) => item.group), keyword);

  return {
    found: true,
    group: best.group,
    keyword,
    strategy,
    ambiguous: true,
    allMatches: results.map((item) => item.group),
    bestScore: best.score
  };
}

if (process.argv.includes('--test')) {
  const groups = [
    { id: '111@g.us', name: 'Monitoring CP_BANGKA' },
    { id: '222@g.us', name: 'Monitoring CP_KOJA_1' },
    { id: '333@g.us', name: 'Monitoring CP_KOJA_2' },
    { id: '444@g.us', name: 'Monitoring CP_JATINEGARA BAR' },
    { id: '555@g.us', name: 'Monitoring CP_JATINEGARA BAR 2' }
  ];

  assert.strictEqual(extractKeyword('CP_ANCOL_BARAT_2'), 'ancol barat 2');
  assert.strictEqual(normalizeGroupName('Monitoring CP_SRENGSENG_SAW...'), 'monitoring cp srengseng saw');

  const bangka = resolveGroupByCP('CP_BANGKA', groups);
  assert.strictEqual(bangka.found, true);
  assert.strictEqual(bangka.group.id, '111@g.us');

  const koja = resolveGroupByCP('CP_KOJA_1', groups);
  assert.strictEqual(koja.found, true);
  assert.strictEqual(koja.group.id, '222@g.us');

  const missing = resolveGroupByCP('CP_XYZ', groups);
  assert.strictEqual(missing.found, false);
  assert.strictEqual(missing.reason, 'NO_GROUP_FOUND');

  const ambiguous = resolveGroupByCP('CP_JATINEGARA_BAR', groups);
  assert.strictEqual(ambiguous.found, true);
  assert.strictEqual(ambiguous.ambiguous, true);
  assert.strictEqual(ambiguous.allMatches.length, 2);

  console.log('groupResolver tests passed');
}

module.exports = {
  normalizeText,
  extractKeyword,
  normalizeGroupName,
  resolveGroupByCP
};
