import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = new URL('../../', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
let task;
try {
  task = getDocument({
    data: new Uint8Array(workerData),
    isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
    // pdf.js expects URL strings here. A Windows path makes the drive letter
    // look like an invalid URL scheme and breaks PDF extraction.
    cMapUrl: new URL('cmaps/', root).href, cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', root).href,
    verbosity: 0,
  });
  const pdf = await task.promise;
  if (pdf.numPages > 20) throw new Error('PDF가 20페이지를 넘어 직접 확인이 필요합니다.');
  const lines = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const { items } = await page.getTextContent();
    const rows = [];
    for (const item of items) {
      if (!('str' in item) || !item.str.trim()) continue;
      let row = rows.find((r) => Math.abs(r.y - item.transform[5]) < 3);
      if (!row) { row = { y: item.transform[5], items: [] }; rows.push(row); }
      row.items.push(item);
    }
    let dutyColumn;
    for (const row of rows.sort((a, b) => b.y - a.y)) {
      // PDF text runs can overlap when punctuation uses another font.
      // Split only overlapping runs into words so punctuation returns between them.
      const expanded = row.items.flatMap((item) => {
        if (!/\s/.test(item.str) || !row.items.some((other) => other !== item
          && other.transform[4] > item.transform[4] && other.transform[4] < item.transform[4] + item.width)) return [item];
        const weight = (text) => [...text].reduce((sum, ch) => sum + (/\s/.test(ch) ? 0.3 : /[^\u0000-\u00ff]/.test(ch) ? 1 : 0.55), 0);
        const total = weight(item.str);
        let offset = 0;
        return item.str.match(/\s+|\S+/g).map((word) => {
          const width = item.width * weight(word) / total;
          const part = { ...item, str: word, width, transform: [...item.transform] };
          part.transform[4] += offset; offset += width;
          return part;
        }).filter((part) => part.str.trim());
      });
      const sorted = expanded.sort((a, b) => a.transform[4] - b.transform[4]);
      let line = '', right;
      for (const item of sorted) {
        if (right !== undefined && item.transform[4] - right > 1.5) line += ' ';
        line += item.str;
        right = item.transform[4] + item.width;
      }
      if (/^\d+[.)]\s/.test(line.trim())) dutyColumn = undefined;
      if (/까지.*근무|근무\s*예정|근로계약기간/.test(line)) dutyColumn = undefined;
      const dutyIndex = sorted.findIndex((item) => /담\s*당\s*업\s*무/.test(item.str));
      if (dutyIndex > 0 && /채용예정일/.test(line)) {
        const previous = sorted[dutyIndex - 1];
        const next = sorted.slice(dutyIndex + 1).find((item) => /채용예정일/.test(item.str));
        if (next) dutyColumn = [previous.transform[4] + previous.width + 2, next.transform[4] - 4];
        lines.push('담당 업무'); continue;
      }
      if (dutyColumn) {
        line = sorted.filter((item) => item.transform[4] >= dutyColumn[0] && item.transform[4] < dutyColumn[1])
          .map((item) => item.str).join(' ').trim();
      }
      if (/[\p{L}\p{N}]/u.test(line)) lines.push(line.trim());
    }
    page.cleanup();
    if (lines.join('\n').length > 80000) throw new Error('PDF 텍스트가 길어 직접 확인이 필요합니다.');
  }
  const text = lines.filter(Boolean).join('\n');
  if (text.replace(/\s/g, '').length < 40 || text.includes('\uFFFD'))
    throw new Error('PDF 텍스트를 읽지 못했습니다. 스캔본 또는 글꼴을 확인해 주세요.');
  parentPort.postMessage({ text });
} catch (error) {
  parentPort.postMessage({ error: error.name === 'PasswordException'
    ? '암호가 설정된 PDF입니다.' : error.message });
} finally {
  await task?.destroy();
}
