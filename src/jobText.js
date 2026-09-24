export function cleanJobText(value = '') {
  let text = String(value).replace(/\s+/g, ' ').trim();
  text = text.replace(/^(.*?일반)\s+([^()]+)\(\s*((?:,\s*)+)([^)]+)\)/, (all, prefix, words, commas, rest) => {
    const parts = words.trim().split(/\s+/);
    return parts.length === (commas.match(/,/g) || []).length
      ? prefix + '(' + parts.join(', ') + ', ' + rest + ')' : all;
  });
  return text.replace(/\s+([,;:])/g, '$1').replace(/(?:,\s*){2,}/g, ', ')
    .replace(/\(\s*[, ]*/g, '(').replace(/\s+[, ]*\)/g, ')')
    .replace(/,\s*/g, ', ').replace(/\s+\(/g, '(').trim();
}

export function separateJobDuties(items = []) {
  const duties = [], employmentNotes = [];
  for (const item of items) {
    const text = cleanJobText(item);
    if (!text) continue;
    if (/까지.*근무|근무\s*예정(?:임|입니다|[.]?$)|^(?:근무|근로계약|계약)\s*기간\s*[:：]/.test(text)) {
      employmentNotes.push(/20\d{2}[.\-/년]\s*\d/.test(text) ? text : '근무기간은 원문 확인 필요');
    } else duties.push(text);
  }
  return { duties: [...new Set(duties)], employmentNotes: [...new Set(employmentNotes)] };
}
