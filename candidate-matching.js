/* Shared 2022 / 2026 comparison. Callers supply one complete, same-zone pair. */
(() => {
  'use strict';
  function match(currentCandidates, previousCandidates) {
    const names = candidates => candidates.filter(candidate => candidate.name && candidate.name !== '姓名未載').map(candidate => {
      const exact = candidate.name.trim();
      const normalized = exact.normalize('NFKC');
      return {candidate, exact, key: normalized.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''),
        han: normalized.replace(/[^\u4e00-\u9fff]/g, '')};
    });
    const index = (entries, field) => {
      const groups = new Map();
      for (const entry of entries) {
        const key = entry[field];
        if (key) groups.set(key, [...(groups.get(key) || []), entry]);
      }
      return groups;
    };
    const current = names(currentCandidates);
    const previous = names(previousCandidates);
    const currentIndexes = Object.fromEntries(['exact', 'key', 'han'].map(field => [field, index(current, field)]));
    const previousIndexes = Object.fromEntries(['exact', 'key', 'han'].map(field => [field, index(previous, field)]));
    const matches = new Map();
    for (const entry of previous) {
      const unique = field => currentIndexes[field].get(entry[field])?.length === 1 && previousIndexes[field].get(entry[field])?.length === 1;
      if (unique('exact')) matches.set(entry.candidate, currentIndexes.exact.get(entry.exact)[0].candidate);
      else if (unique('key')) matches.set(entry.candidate, currentIndexes.key.get(entry.key)[0].candidate);
      else if (entry.han.length >= 2 && unique('han') &&
        (entry.key === entry.han || currentIndexes.han.get(entry.han)[0].key === entry.han)) matches.set(entry.candidate, currentIndexes.han.get(entry.han)[0].candidate);
    }
    return matches;
  }
  function registrationSourceDescription(metadata, sourceUrl) {
    let printedOn = '';
    try {
      const source = new URL(sourceUrl);
      const recorded = new URL(metadata?.sourceUrl);
      const value = metadata?.printedOn;
      if (metadata?.dateMeaning === 'bookPrinted' && ['local_official_pdf', 'manual_transcription'].includes(metadata?.evidenceKind) && source.protocol === 'https:' && source.href === recorded.href && /^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) printedOn = value;
      }
    } catch { /* Unverified metadata remains explicitly unavailable. */ }
    const evidence = printedOn && metadata.evidenceKind === 'manual_transcription' ? '製表日依既有核對紀錄，本次未驗證原PDF。' : '';
    return `名冊製表日：${printedOn || '本次未取得'}；官方網站更新日：本次未取得。${evidence}本站使用已收錄快照，非即時同步；最新名單以官方公告為準。`;
  }
  window.ElectionRegistrationSource = Object.freeze({describe: registrationSourceDescription});
  window.ElectionCandidateMatching = Object.freeze({match});
})();
