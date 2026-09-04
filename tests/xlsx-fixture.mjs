import { zipSync, strToU8 } from 'fflate';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const xlsxFixture = (extra = {}) =>
  zipSync(
    Object.fromEntries(
      Object.entries({
        '[Content_Types].xml': '<Types/>',
        'xl/workbook.xml': `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Объёмы" sheetId="1" r:id="r1"/><sheet name="Скрытый" sheetId="2" state="hidden" r:id="r2"/></sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="r1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="${R}/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="r3" Type="${R}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="r4" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
        'xl/sharedStrings.xml': `<sst xmlns="${S}"><si><r><t>Монтаж </t></r><r><t>кабеля</t></r></si></sst>`,
        'xl/styles.xml': `<styleSheet xmlns="${S}"><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="9"/></cellXfs></styleSheet>`,
        'xl/worksheets/sheet1.xml': `<worksheet xmlns="${S}"><dimension ref="A1:XFD1048576"/><sheetData><row r="3"><c r="B3" t="s"><v>0</v></c><c r="D3" t="inlineStr"><is><t>м</t></is></c><c r="E3"><v>100.00000000000001</v></c><c r="F3"><f>E3*2</f><v>200</v></c></row><row r="5"><c r="B5"><f>1+2</f></c><c r="C5" t="e"><f>1/0</f><v>#DIV/0!</v></c><c r="D5" s="1"><v>61</v></c><c r="E5" s="2"><v>0.15</v></c></row><row r="1048576"><c r="A1048576"/></row></sheetData><mergeCells><mergeCell ref="B3:C3"/></mergeCells></worksheet>`,
        'xl/worksheets/sheet2.xml': `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Проверить скрытые данные</t></is></c></row></sheetData></worksheet>`,
        ...extra,
      }).map(([name, value]) => [
        name,
        typeof value === 'string' ? strToU8(value) : value,
      ]),
    ),
  );
