import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectXlsx } from '../lib/ppr-xlsx.ts';
import { extractFile } from '../lib/ppr-docx.ts';
import { verifiedProposals } from '../lib/ppr-workspace.ts';
import { readSourcePurpose } from '../lib/work-sources.ts';
import { xlsxFixture } from './xlsx-fixture.mjs';

test('Sparse XLSX preserves sheet, row and cell provenance, exact decimals, merges and hidden data', async () => {
  const result = inspectXlsx(xlsxFixture());
  assert.deepEqual(
    result.sheets.map((s) => [s.name, s.cells, s.hidden]),
    [
      ['Объёмы', 8, false],
      ['Скрытый', 1, true],
    ],
  );
  const row = result.blocks.find((b) => b.id === 'sheet-1-B3-F3');
  assert.match(row.text, /B3: Монтаж кабеля\nD3: м\nE3: 100\.00000000000001/);
  assert.match(
    result.blocks.find((b) => b.id === 'sheet-1-merges').text,
    /B3:C3/,
  );
  assert.ok(result.warnings.some((w) => w.includes('скрытых областях: 1')));
  const extracted = await extractFile({
    name: 'input.xlsx',
    bytes: xlsxFixture(),
  });
  assert.ok(extracted.blocks.some((b) => b.id === 'sheet-1-B3-F3:0'));
  assert.equal(extracted.sheets.length, 2);
  assert.equal(extracted.warnings.length, 3);
});
test('Formulas use cached values only, absent/error values never become zero, dates retain originals', () => {
  const result = inspectXlsx(xlsxFixture());
  const output = result.blocks.map((b) => b.text).join('\n');
  assert.match(output, /F3: 200 \[сохранённый результат/);
  assert.match(output, /B5: \[НЕТ СОХРАНЁННОГО РЕЗУЛЬТАТА\]/);
  assert.match(output, /C5: #DIV\/0!/);
  assert.match(output, /D5: 61 .*1900-03-01T00:00:00.000/);
  assert.match(output, /E5: 0.15 \[формат Excel: 0%\]/);
  assert.ok(
    result.warnings.some((w) =>
      w.includes('Нет результата: 1; ошибок Excel: 1'),
    ),
  );
});
test('XLSX rejects macros, external workbooks, invalid XML, wrong indices and oversized ZIP parts', () => {
  for (const extra of [
    { 'xl/vbaProject.bin': 'binary' },
    { 'xl/evil.xml': '<!DOCTYPE x [<!ENTITY a "x">]><x/>' },
    {
      'xl/_rels/evil.rels':
        '<Relationships><Relationship Type="externalLink" TargetMode="External" Target="file:///C:/private.xlsx"/></Relationships>',
    },
    { 'xl/sharedStrings.xml': '<broken' },
    {
      'xl/worksheets/sheet1.xml':
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="s"><v>999</v></c></row></sheetData></worksheet>',
    },
    { 'huge.bin': new Uint8Array(12_000_001) },
  ])
    assert.throws(() => inspectXlsx(xlsxFixture(extra)));
});
test('Source purpose blocks construction-party substitution from a PPR developer contract', () => {
  const proposal = {
    field: 'brief.contractor.organization',
    value: 'Разработчик',
    fileHash: 'a'.repeat(64),
    blockId: 'p-1',
    quote: 'Исполнитель Разработчик',
    reason: 'Цитата',
  };
  const file = {
    hash: proposal.fileHash,
    blocks: [{ id: proposal.blockId, text: proposal.quote }],
  };
  assert.equal(
    verifiedProposals([proposal], [{ ...file, purpose: 'ppr_contract' }])
      .length,
    0,
  );
  assert.equal(
    verifiedProposals(
      [proposal],
      [{ ...file, purpose: 'construction_contract' }],
    ).length,
    1,
  );
  assert.equal(
    verifiedProposals(
      [{ ...proposal, field: 'brief.additional' }],
      [{ ...file, purpose: 'ppr_contract' }],
    ).length,
    1,
  );
  assert.equal(readSourcePurpose(undefined), 'unspecified');
  assert.throws(() => readSourcePurpose('__proto__'));
});
