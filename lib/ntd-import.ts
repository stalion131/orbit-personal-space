import { createHash } from 'node:crypto';
import { inspectXlsx } from './ppr-xlsx.ts';
import { safeNtdUrl, type NtdLibrary, type NtdRecord } from './ntd-types.ts';

export const registryColumns = [
  'ID',
  'Раздел',
  'Подраздел',
  'Документ',
  'Наименование',
  'Уровень обязательности',
  'Когда применять',
  'Этап',
  'Что проверить',
  'Юридическое основание',
  'Статус на дату базы',
  'Дата проверки',
  'Официальный источник',
  'Примечание/риск',
  'Теги',
];
export const permitColumns = [
  'ID',
  'Вид работ',
  'Опасность и последствия',
  'Когда оформляют наряд',
  'Основание решения',
  'НПА и точный пункт',
  'Вид наряда / допуск',
  'Что проверить до допуска',
  'Исключения и ограничения',
  'Официальный источник',
  'Текст для сверки',
  'Дата проверки',
];

export function importNtdRoadmap(name: string, bytes: Uint8Array): NtdLibrary {
  if (!/\.xlsx$/i.test(name) || bytes.length > 2_500_000)
    throw new Error('Выберите реестр XLSX размером до 2,5 МБ.');
  const book = inspectXlsx(bytes, true);
  const table = (
    sheet: string,
    columns: string[],
    pattern: RegExp,
  ): NtdRecord[] => {
    const rows = new Map<number, Map<string, (typeof book.cells)[number]>>();
    for (const cell of book.cells.filter((c) => c.sheet === sheet)) {
      const [, col, index] = /^([A-Z]+)(\d+)$/.exec(cell.address)!;
      const row = rows.get(Number(index)) || new Map();
      row.set(col, cell);
      rows.set(Number(index), row);
    }
    const header = [...rows].find(([, row]) => row.get('A')?.value === 'ID');
    if (
      !header ||
      columns.some(
        (label, i) =>
          header[1].get(String.fromCharCode(65 + i))?.value !== label,
      )
    )
      throw new Error(`Не найдены ожидаемые столбцы листа «${sheet}».`);
    const records: NtdRecord[] = [];
    const ids = new Set<string>();
    for (const [rowNumber, row] of rows) {
      if (rowNumber <= header[0]) continue;
      const id = row.get('A')?.value || '';
      if (!id) continue;
      if (!pattern.test(id) || ids.has(id))
        throw new Error(`Проверьте ID в «${sheet}», строка ${rowNumber}.`);
      ids.add(id);
      const fields: Record<string, string> = {};
      for (const [i, label] of columns.entries()) {
        const cell = row.get(String.fromCharCode(65 + i));
        if (cell?.formula || cell?.error)
          throw new Error(
            `Реестр должен содержать значения без формул и ошибок: ${sheet}, ${cell.address}.`,
          );
        const value = cell?.value.trim() || '';
        if (value.length > 5000)
          throw new Error('Слишком длинная ячейка реестра.');
        if (
          ['Официальный источник', 'Текст для сверки'].includes(label) &&
          value &&
          !safeNtdUrl(value)
        )
          throw new Error(
            `Некорректная ссылка: ${sheet}, строка ${rowNumber}.`,
          );
        fields[label] = value;
      }
      records.push({ id, sheet, row: rowNumber, fields });
    }
    if (!records.length || records.length > 2000)
      throw new Error(`Нужно от 1 до 2000 записей на листе «${sheet}».`);
    return records;
  };
  return {
    schema: 'orbit-ntd-roadmap-v1',
    name,
    hash: createHash('sha256').update(bytes).digest('hex'),
    importedAt: new Date().toISOString(),
    records: table('01_База НТД', registryColumns, /^\d+$/),
    permits: table('05_Наряды-допуски', permitColumns, /^НД-\d{2}$/),
    warnings: [
      'Реестр и даты проверки взяты из вашего Excel. Актуальность и применимость сервисом не подтверждены.',
      'Полные тексты НТД не загружены. Выбор риска не является разрешением на работы или решением о наряде-допуске.',
      ...book.warnings,
    ],
  };
}
