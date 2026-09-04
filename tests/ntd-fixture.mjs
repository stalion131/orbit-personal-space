import { xlsxFixture } from './xlsx-fixture.mjs';
const registryColumns = [
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
const permitColumns = [
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
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const sheet = (cols, id, extra = '') =>
  `<worksheet xmlns="${S}"><sheetData><row r="4">${cols.map((c, i) => `<c r="${String.fromCharCode(65 + i)}4" t="inlineStr"><is><t>${c}</t></is></c>`).join('')}</row><row r="5"><c r="A5" t="inlineStr"><is><t>${id}</t></is></c>${extra}</row></sheetData></worksheet>`;
export const ntdFixture = (extra = '') =>
  xlsxFixture({
    'xl/workbook.xml': `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="01_База НТД" sheetId="1" r:id="r1"/><sheet name="05_Наряды-допуски" sheetId="2" r:id="r2"/></sheets></workbook>`,
    'xl/worksheets/sheet1.xml': sheet(registryColumns, '1', extra),
    'xl/worksheets/sheet2.xml': sheet(permitColumns, 'НД-01'),
  });
