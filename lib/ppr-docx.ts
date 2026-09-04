import { createHash } from 'node:crypto';
import { zipSync, strFromU8, strToU8 } from 'fflate';
import { XMLSerializer, type Element, type Document } from '@xmldom/xmldom';
import type { TextBlock, TextChange } from './ppr-workspace';
import { officePackage, officeXml as xml } from './office-package.ts';
import { inspectXlsx } from './ppr-xlsx.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const MAX_FILE_BYTES = 2_500_000;
export const MAX_TEXT = 100_000;
export const hashBytes = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
function fail(text: string): never {
  throw new Error(text);
}
export function decodeFile(value: unknown): {
  name: string;
  bytes: Uint8Array;
} {
  const file = value as { name?: unknown; base64?: unknown } | null;
  if (
    !file ||
    typeof file.name !== 'string' ||
    file.name.length > 200 ||
    /[\\/]/.test(file.name) ||
    Array.from(file.name).some((c) => c.charCodeAt(0) < 32) ||
    !/\.(docx|xlsx|pdf|txt)$/i.test(file.name) ||
    typeof file.base64 !== 'string' ||
    file.base64.length > 3_333_336 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)
  )
    fail('Выберите DOCX, XLSX, PDF или TXT размером до 2,5 МБ.');
  const bytes = Buffer.from(file.base64 as string, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES)
    fail('Размер файла превышает 2,5 МБ. Разделите исходные данные на части.');
  return { name: file.name as string, bytes };
}
const elements = (el: Element | Document, name: string) =>
  Array.from(el.getElementsByTagNameNS(W, name));
const content = (el: Element) =>
  elements(el, 't')
    .map((t) => t.textContent || '')
    .join('');
function readPackage(bytes: Uint8Array) {
  const entries = officePackage(bytes, 'DOCX');
  if (!entries['word/document.xml'] || !entries['[Content_Types].xml'])
    fail('Файл не является DOCX.');
  const document = xml(strFromU8(entries['word/document.xml']));
  const body = elements(document, 'body')[0];
  if (!body) fail('В DOCX нет основного текста.');
  return { entries, document, body };
}

export function inspectDocx(bytes: Uint8Array) {
  const { body, entries } = readPackage(bytes);
  const styleNames = new Map<string, string>();
  if (entries['word/styles.xml'])
    for (const style of elements(
      xml(strFromU8(entries['word/styles.xml'])),
      'style',
    )) {
      styleNames.set(
        style.getAttributeNS(W, 'styleId') || '',
        elements(style, 'name')[0]?.getAttributeNS(W, 'val') || '',
      );
    }
  const blocks = elements(body, 'p')
    .map((p, i) => ({ id: `p-${i}`, text: content(p) }))
    .filter((b) => b.text.trim());
  const paragraphs = elements(body, 'p')
    .map((p, i) => {
      const text = content(p);
      const style = elements(p, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
      return {
        id: `p-${i}`,
        text,
        heading:
          /heading|заголовок/i.test(styleNames.get(style) || style) ||
          /^\d{1,2}[.\s]/.test(text),
        topLevel: p.parentNode === body,
      };
    })
    .filter((p) => p.topLevel && p.text.trim());
  return {
    blocks,
    paragraphs,
    characters: blocks.reduce((n, b) => n + b.text.length, 0),
  };
}

export async function extractFile(
  file: { name: string; bytes: Uint8Array },
  maximumText = MAX_TEXT,
) {
  let blocks: TextBlock[];
  let warnings: string[] = [];
  let sheets: { name: string; cells: number; hidden: boolean }[] = [];
  if (/\.docx$/i.test(file.name)) blocks = inspectDocx(file.bytes).blocks;
  else if (/\.xlsx$/i.test(file.name)) {
    ({ blocks, warnings, sheets } = inspectXlsx(file.bytes));
  } else if (/\.pdf$/i.test(file.name)) {
    const { getDocumentProxy, extractText } = await import('unpdf');
    const document = await getDocumentProxy(new Uint8Array(file.bytes), {
      useSystemFonts: false,
      verbosity: 0,
    });
    try {
      if (document.numPages > 300)
        fail('Более 300 страниц. Загрузите часть документа.');
      const result = await extractText(document, { mergePages: false });
      blocks = result.text.map((text, i) => ({ id: `page-${i + 1}`, text }));
    } finally {
      await document.loadingTask.destroy();
    }
  } else {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
    } catch {
      return fail('TXT должен быть сохранён в UTF-8.');
    }
    if (text.includes('\0')) fail('TXT содержит двоичные данные.');
    blocks = text
      .split(/\r?\n\s*\r?\n/)
      .map((text, i) => ({ id: `text-${i + 1}`, text }));
  }
  const characters = blocks.reduce((n, b) => n + b.text.length, 0);
  if (!characters || !blocks.some((b) => b.text.trim()))
    fail('Текст не найден. Для скана сначала выполните распознавание OCR.');
  if (characters > maximumText)
    fail(
      `Более ${maximumText.toLocaleString('ru')} знаков. Загрузите часть документа: текст не будет скрыто обрезан.`,
    );
  // Stable split IDs preserve page/paragraph provenance while bounding model snippets.
  blocks = blocks.flatMap((b) =>
    Array.from({ length: Math.ceil(b.text.length / 1800) }, (_, i) => ({
      id: `${b.id}:${i}`,
      text: b.text.slice(i * 1800, (i + 1) * 1800),
    })),
  );
  return {
    hash: hashBytes(file.bytes),
    name: file.name,
    size: file.bytes.length,
    characters,
    blocks,
    warnings,
    sheets,
  };
}

export type SectionReplacement = {
  start: string;
  end: string;
  paragraphs: { text: string; changed: boolean }[];
};
export function assembleDocx(
  bytes: Uint8Array,
  replacements: SectionReplacement[],
) {
  const { document, entries, body } = readPackage(bytes);
  const paragraphs = elements(body, 'p');
  const children = Array.from(body.childNodes);
  const ranges = replacements
    .map((r) => {
      const start = paragraphs[Number(r.start.replace(/^p-/, ''))];
      const end =
        r.end === 'end'
          ? elements(body, 'sectPr').at(-1)
          : paragraphs[Number(r.end.replace(/^p-/, ''))];
      if (
        !/^p-\d+$/.test(r.start) ||
        !/^(p-\d+|end)$/.test(r.end) ||
        !start ||
        !end ||
        start.parentNode !== body ||
        end.parentNode !== body
      )
        return fail('Выберите границы раздела в основном тексте документа.');
      const a = children.indexOf(start),
        b = children.indexOf(end);
      if (b <= a) fail('Конец раздела должен идти после заголовка.');
      return { ...r, start, end, a, b };
    })
    .sort((a, b) => a.a - b.a);
  if (ranges.some((r, i) => i > 0 && r.a < ranges[i - 1].b))
    fail('Диапазоны разделов пересекаются.');
  for (const range of ranges) {
    const original = children
      .slice(range.a + 1, range.b)
      .filter((n) => n.nodeType === 1) as Element[];
    const removable = original.filter(
      (n) => n.namespaceURI === W && n.localName === 'p',
    );
    // Text with drawings, fields, tracked changes, bookmarks, math or section breaks is never destroyed.
    for (const p of removable) {
      if (
        Array.from(p.getElementsByTagName('*')).some(
          (n) =>
            ![
              'pPr',
              'rPr',
              'r',
              't',
              'b',
              'bCs',
              'i',
              'iCs',
              'color',
              'sz',
              'szCs',
              'rFonts',
              'lang',
              'u',
              'spacing',
              'ind',
              'jc',
              'pStyle',
              'rStyle',
              'numPr',
              'ilvl',
              'numId',
              'keepNext',
              'keepLines',
              'widowControl',
              'contextualSpacing',
              'tab',
              'tabs',
              'br',
              'shd',
              'outlineLvl',
              'suppressAutoHyphens',
              'snapToGrid',
              'pageBreakBefore',
            ].includes(n.localName || ''),
        )
      )
        fail(
          'В диапазоне есть защищённые или сложные элементы Word. Выберите текстовую часть без полей, закладок и схем.',
        );
    }
    const sample = removable[0];
    const anchor = removable[0] || range.end;
    for (const value of range.paragraphs) {
      const unchanged = removable.find(
        (p) => content(p).trim() === value.text.trim(),
      );
      if (!value.changed && unchanged) {
        body.insertBefore(unchanged.cloneNode(true), anchor);
        continue;
      }
      const p = document.createElementNS(W, 'w:p');
      const pPr = sample && elements(sample, 'pPr')[0];
      if (pPr) p.appendChild(pPr.cloneNode(true));
      const r = document.createElementNS(W, 'w:r'),
        rPr = document.createElementNS(W, 'w:rPr');
      const sampleRPr = sample && elements(sample, 'rPr')[0];
      if (sampleRPr)
        for (const node of Array.from(sampleRPr.childNodes))
          rPr.appendChild(node.cloneNode(true));
      for (const c of elements(rPr, 'color')) c.parentNode?.removeChild(c);
      const color = document.createElementNS(W, 'w:color');
      color.setAttributeNS(W, 'w:val', '0000FF');
      rPr.appendChild(color);
      r.appendChild(rPr);
      const t = document.createElementNS(W, 'w:t');
      t.setAttribute('xml:space', 'preserve');
      t.appendChild(document.createTextNode(value.text));
      r.appendChild(t);
      p.appendChild(r);
      body.insertBefore(p, anchor);
    }
    for (const p of removable) body.removeChild(p);
  }
  entries['word/document.xml'] = strToU8(
    new XMLSerializer().serializeToString(document),
  );
  return zipSync(entries, { level: 6 });
}

// LCS of paragraphs: additions do not shift every subsequent comparison.
export function compareDocx(
  before: Uint8Array,
  after: Uint8Array,
): TextChange[] {
  const left = inspectDocx(before).blocks.map((b) => b.text),
    right = inspectDocx(after).blocks.map((b) => b.text);
  if (left.length > 2500 || right.length > 2500)
    fail('Для сравнения загрузите часть DOCX: не более 2500 абзацев.');
  const width = right.length + 1,
    matrix = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      matrix[i * width + j] =
        left[i] === right[j]
          ? 1 + matrix[(i + 1) * width + j + 1]
          : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
  const changes: TextChange[] = [];
  let i = 0,
    j = 0,
    removed: string[] = [],
    added: string[] = [];
  const flush = () => {
    if (removed.length || added.length) {
      changes.push({ before: removed.join('\n'), after: added.join('\n') });
      removed = [];
      added = [];
    }
  };
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      flush();
      i++;
      j++;
    } else if (
      i < left.length &&
      (j === right.length ||
        matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])
    )
      removed.push(left[i++]);
    else added.push(right[j++]);
  }
  flush();
  return changes;
}
