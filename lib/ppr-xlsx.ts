import { strFromU8 } from 'fflate';
import type { Document, Element } from '@xmldom/xmldom';
import { officePackage, officeXml } from './office-package.ts';
import type { TextBlock } from './ppr-workspace';

const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const all = (el: Document | Element, name: string) =>
  Array.from(el.getElementsByTagNameNS(S, name));
const text = (el: Element | undefined) =>
  el
    ? all(el, 't')
        .filter((t) => t.parentNode?.localName !== 'rPh')
        .map((t) => t.textContent || '')
        .join('')
    : '';
const invalid = (): never => {
  throw new Error(
    'Неподдерживаемая или повреждённая структура XLSX. Пересохраните копию в Excel.',
  );
};
const column = (s: string) =>
  Array.from(s).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
function address(value: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value);
  if (!match || column(match[1]) > 16384 || Number(match[2]) > 1048576)
    return invalid();
  return { col: column(match[1]), row: Number(match[2]) };
}
const standardFormats: Record<number, string> = {
  9: '0%',
  10: '0.00%',
  14: 'mm-dd-yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
};

// Read only physically present cells: a formatted row at 1048576 must not allocate a million-row matrix.
export function inspectXlsx(bytes: Uint8Array, includeCells = false) {
  const entries = officePackage(bytes, 'XLSX');
  const part = (path: string) =>
    entries[path] ? officeXml(strFromU8(entries[path])) : invalid();
  const workbook = part('xl/workbook.xml');
  if (workbook.documentElement?.namespaceURI !== S) invalid();
  const relations = Array.from(
    part('xl/_rels/workbook.xml.rels').getElementsByTagNameNS(
      '*',
      'Relationship',
    ),
  );
  const pathFor = (relation: Element) => {
    const target = relation.getAttribute('Target') || '';
    if (!target || /[\\?#%]|(^|\/)\.\.?($|\/)/.test(target)) return invalid();
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    if (!path.startsWith('xl/') || !entries[path]) return invalid();
    return path;
  };
  const optional = (kind: string) => {
    const r = relations.find((r) => r.getAttribute('Type') === `${R}/${kind}`);
    return r ? part(pathFor(r)) : null;
  };
  const strings = optional('sharedStrings');
  const shared = strings ? all(strings, 'si').map(text) : [];
  const styles = optional('styles');
  const formats = new Map(
    styles
      ? all(styles, 'numFmt').map(
          (f) =>
            [
              Number(f.getAttribute('numFmtId')),
              f.getAttribute('formatCode') || '',
            ] as const,
        )
      : [],
  );
  const cellStyles = styles ? all(styles, 'cellXfs')[0] : undefined;
  const styleIds = cellStyles
    ? all(cellStyles, 'xf').map((f) => Number(f.getAttribute('numFmtId') || 0))
    : [];
  const date1904 = ['1', 'true'].includes(
    all(workbook, 'workbookPr')[0]?.getAttribute('date1904') || '',
  );
  const sheetNodes = all(workbook, 'sheet');
  if (!sheetNodes.length || sheetNodes.length > 40)
    throw new Error('Нужно от 1 до 40 листов XLSX. Разделите книгу.');
  const blocks: TextBlock[] = [];
  const sheets: { name: string; cells: number; hidden: boolean }[] = [];
  const cells: {
    sheet: string;
    address: string;
    value: string;
    formula: boolean;
    error: boolean;
  }[] = [];
  let cellCount = 0,
    formulaCount = 0,
    missing = 0,
    errors = 0,
    hiddenCount = 0,
    characters = 0;
  const append = (block: TextBlock) => {
    characters += block.text.length;
    if (characters > 500000)
      throw new Error(
        'Более 500 000 знаков в XLSX. Загрузите часть книги: текст не будет скрыто обрезан.',
      );
    blocks.push(block);
  };
  const sheetNames = new Set<string>();
  for (const [index, sheet] of sheetNodes.entries()) {
    const name = sheet.getAttribute('name') || '';
    if (!name || name.length > 31 || sheetNames.has(name)) invalid();
    sheetNames.add(name);
    const rel = relations.filter(
      (r) => r.getAttribute('Id') === sheet.getAttributeNS(R, 'id'),
    );
    if (rel.length !== 1 || rel[0].getAttribute('Type') !== `${R}/worksheet`)
      invalid();
    const doc = part(pathFor(rel[0]));
    const hidden = ['hidden', 'veryHidden'].includes(
      sheet.getAttribute('state') || '',
    );
    const rows = all(doc, 'row');
    const hiddenColumns = all(doc, 'col')
      .filter((c) => ['1', 'true'].includes(c.getAttribute('hidden') || ''))
      .map((c) => [
        Number(c.getAttribute('min')),
        Number(c.getAttribute('max')),
      ]);
    const seen = new Set<string>();
    let sheetCells = 0;
    for (const row of rows) {
      const lines: string[] = [];
      let first = '',
        last = '';
      for (const cell of all(row, 'c')) {
        const a = cell.getAttribute('r') || '';
        const pos = address(a);
        if (seen.has(a)) invalid();
        seen.add(a);
        if (seen.size > 100000)
          throw new Error(
            'Слишком много записанных ячеек на листе, включая пустое форматирование. Сохраните меньшую копию.',
          );
        const kind = cell.getAttribute('t') || 'n';
        const formula = all(cell, 'f')[0];
        const raw = all(cell, 'v')[0]?.textContent || '';
        let value = raw;
        if (kind === 's') {
          if (!/^\d+$/.test(raw) || shared[Number(raw)] === undefined)
            invalid();
          value = shared[Number(raw)];
        } else if (kind === 'inlineStr') value = text(all(cell, 'is')[0]);
        else if (kind === 'b') {
          if (!['0', '1'].includes(raw)) invalid();
          value = raw === '1' ? 'TRUE' : 'FALSE';
        } else if (!['n', 'str', 'e', 'd'].includes(kind)) invalid();
        if (!value && !formula) continue;
        if (++cellCount > 50000)
          throw new Error('Более 50 000 заполненных ячеек. Разделите книгу.');
        sheetCells++;
        if (!first) first = a;
        last = a;
        const notes: string[] = [];
        if (
          hidden ||
          ['1', 'true'].includes(row.getAttribute('hidden') || '') ||
          hiddenColumns.some(([min, max]) => pos.col >= min && pos.col <= max)
        ) {
          notes.push('скрытая область');
          hiddenCount++;
        }
        if (kind === 'e') {
          notes.push('ошибка Excel, не использовать как число');
          errors++;
        }
        if (formula) {
          formulaCount++;
          notes.push('сохранённый результат формулы, без пересчёта');
          if (!raw) {
            value = '[НЕТ СОХРАНЁННОГО РЕЗУЛЬТАТА]';
            missing++;
          }
        }
        const style = cell.getAttribute('s');
        const formatId = style ? styleIds[Number(style)] : 0;
        if (style && formatId === undefined) invalid();
        const fmt = formats.get(formatId) || standardFormats[formatId];
        if (fmt && (kind === 'n' || !kind)) {
          notes.push(`формат Excel: ${fmt}`);
          if (
            formatId >= 14 &&
            formatId <= 22 &&
            value &&
            Number.isFinite(Number(value))
          ) {
            const serial = Number(value);
            if (
              serial >= 0 &&
              serial < 2958466 &&
              (date1904 || Math.floor(serial) !== 60)
            ) {
              const days = date1904 ? serial : serial - (serial >= 60 ? 1 : 0);
              const date = new Date(
                Date.UTC(
                  date1904 ? 1904 : 1899,
                  date1904 ? 0 : 11,
                  date1904 ? 1 : 31,
                ) + Math.round(days * 86400000),
              );
              notes.push(
                `дата/время ISO: ${date.toISOString().replace('Z', '')}`,
              );
            }
          }
        }
        if (includeCells)
          cells.push({
            sheet: name,
            address: a,
            value:
              notes.find((n) => n.startsWith('дата/время ISO: '))?.slice(16) ||
              value,
            formula: !!formula,
            error: kind === 'e',
          });
        lines.push(
          `${a}: ${value}${notes.length ? ` [${notes.join('; ')}]` : ''}`,
        );
      }
      if (lines.length)
        append({
          id: `sheet-${index + 1}-${first}-${last}`,
          text: `Лист «${name}», строка ${address(first).row}\n${lines.join('\n')}`,
        });
    }
    const merges = all(doc, 'mergeCell').map(
      (m) => m.getAttribute('ref') || '',
    );
    if (merges.length > 10000)
      throw new Error('Слишком много объединённых ячеек. Разделите книгу.');
    for (const range of merges) {
      const parts = range.split(':');
      if (parts.length !== 2) invalid();
      const start = address(parts[0]),
        end = address(parts[1]);
      if (start.row > end.row || start.col > end.col) invalid();
    }
    if (merges.length)
      append({
        id: `sheet-${index + 1}-merges`,
        text: `Лист «${name}»: объединённые диапазоны (значение хранится в верхней левой ячейке): ${merges.join(', ')}`,
      });
    sheets.push({ name, cells: sheetCells, hidden });
  }
  const warnings = [
    'XLSX: прочитаны значения ячеек и объединения. Рисунки, диаграммы и комментарии не анализировались. Нестандартные числовые форматы переданы как описание, без пересчёта.',
  ];
  if (formulaCount)
    warnings.push(
      `Формулы: ${formulaCount}. Использованы сохранённые результаты; актуальность не проверялась. Нет результата: ${missing}; ошибок Excel: ${errors}.`,
    );
  else if (errors)
    warnings.push(
      `Ошибок Excel: ${errors}. Не использовать как числовые данные.`,
    );
  if (hiddenCount)
    warnings.push(
      `Прочитано ячеек в скрытых областях: ${hiddenCount}. Они явно помечены в тексте.`,
    );
  return { blocks, warnings, sheets, cells };
}
