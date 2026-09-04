import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import {
  assembleDocx,
  inspectDocx,
  compareDocx,
  extractFile,
  decodeFile,
} from '../lib/ppr-docx.ts';
import {
  verifiedProposals,
  applyProposals,
  fieldValue,
  confirmedExperience,
  readPprWorkspace,
  PPR_MODEL,
} from '../lib/ppr-workspace.ts';
import { pdfFixture } from './pdf-fixture.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const para = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const fixture = (extra = '', entries = {}) =>
  zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${para('1 Общие положения')}${para('Старый текст')}${extra}<w:tbl><w:tr><w:tc>${para('Таблица сохраняется')}</w:tc></w:tr></w:tbl>${para('2 Организация')}${para('Не менять')}<w:sectPr/></w:body></w:document>`,
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}"/>`),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}">${para('Колонтитул')}</w:hdr>`,
    ),
    'word/media/image.png': new Uint8Array([1, 2, 3]),
    ...entries,
  });
test('DOCX retains package parts, tables, headers and unchanged sections; changes are blue', () => {
  const original = fixture(),
    info = inspectDocx(original);
  const originalSnapshot = original.slice();
  const start = info.paragraphs.find((p) => p.text.startsWith('1 ')).id,
    end = info.paragraphs.find((p) => p.text.startsWith('2 ')).id;
  const output = assembleDocx(original, [
    {
      start,
      end,
      paragraphs: [{ text: 'Новый текст & данные', changed: true }],
    },
  ]);
  const before = unzipSync(original),
    after = unzipSync(output);
  assert.deepEqual(original, originalSnapshot, 'Assembly must not mutate the source template');
  for (const name of Object.keys(before))
    if (name !== 'word/document.xml')
      assert.deepEqual(after[name], before[name], name);
  const xml = strFromU8(after['word/document.xml']);
  assert.ok(xml.includes('0000FF'));
  assert.ok(xml.includes('Таблица сохраняется'));
  assert.ok(xml.includes('Не менять'));
  assert.ok(!xml.includes('Старый текст'));
  assert.ok(xml.includes('&amp;'));
  assert.deepEqual(compareDocx(original, output), [
    { before: 'Старый текст', after: 'Новый текст & данные' },
  ]);
});
test('DOCX guards reject DTD, macros, external file relationships and protected ranges', () => {
  assert.ok(
    inspectDocx(
      fixture('', {
        'word/_rels/document.xml.rels': strToU8(
          '<Relationships><Relationship TargetMode="External" Target="mailto:office@example.org" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"/></Relationships>',
        ),
      }),
    ).blocks.length,
  );
  assert.throws(() =>
    inspectDocx(
      fixture('', {
        'word/evil.xml': strToU8('<!DOCTYPE x [<!ENTITY a "x">]><x/>'),
      }),
    ),
  );
  assert.throws(() =>
    inspectDocx(fixture('', { 'word/vbaProject.bin': strToU8('x') })),
  );
  assert.throws(() =>
    inspectDocx(
      fixture('', {
        'word/_rels/document.xml.rels': strToU8(
          '<Relationships><Relationship TargetMode="External" Target="file:///C:/secret" Type="externalLink"/></Relationships>',
        ),
      }),
    ),
  );
  assert.throws(() =>
    inspectDocx(fixture('', { 'huge.bin': new Uint8Array(13_000_000) })),
  );
  const protectedFile = fixture(
    '<w:p><w:bookmarkStart w:id="1" w:name="protected"/><w:r><w:t>Не трогать</w:t></w:r></w:p>',
  );
  const info = inspectDocx(protectedFile);
  assert.throws(
    () =>
      assembleDocx(protectedFile, [
        {
          start: 'p-0',
          end: info.paragraphs.find((p) => p.text.startsWith('2 ')).id,
          paragraphs: [],
        },
      ]),
    /сложные/,
  );
  assert.throws(
    () =>
      assembleDocx(fixture(), [{ start: 'p-3', end: 'p-0', paragraphs: [] }]),
    /Конец/,
  );
});
test('Digital sources preserve provenance; large and binary inputs are rejected without silent truncation', async () => {
  const pdf = await extractFile({ name: 'source.pdf', bytes: pdfFixture() });
  assert.ok(pdf.blocks.some((b) => b.text.includes('SITE DATA 24')));
  const source = await extractFile({ name: 'source.docx', bytes: fixture() });
  assert.ok(source.blocks.some((b) => b.text === 'Таблица сохраняется'));
  assert.equal(source.hash.length, 64);
  const text = await extractFile({
    name: 'source.txt',
    bytes: strToU8('А'.repeat(1900)),
  });
  assert.deepEqual(
    text.blocks.map((b) => b.text.length),
    [1800, 100],
  );
  await assert.rejects(
    () =>
      extractFile({ name: 'source.txt', bytes: strToU8('x'.repeat(100001)) }),
    /Загрузите часть/,
  );
  await assert.rejects(
    () => extractFile({ name: 'source.txt', bytes: new Uint8Array([255, 0]) }),
    /UTF-8/,
  );
  assert.throws(() => decodeFile({ name: '../file.docx', base64: 'YQ==' }));
  assert.throws(() => decodeFile({ name: 'file.docm', base64: 'YQ==' }));
});
test('Proposals must have actual source quotes and cannot write arbitrary fields', () => {
  const p = {
    field: 'objectAddress',
    value: 'Улица 1',
    fileHash: 'a'.repeat(64),
    blockId: 'p-1',
    quote: 'Адрес: Улица 1',
    reason: 'Из исходных данных',
  };
  const files = [
    { hash: p.fileHash, blocks: [{ id: p.blockId, text: p.quote }] },
  ];
  assert.equal(
    verifiedProposals(
      [p, { ...p, field: 'workType', quote: 'Invented' }],
      files,
    ).length,
    1,
  );
  assert.throws(() => applyProposals({}, {}, [{ ...p, field: '__proto__.x' }]));
  const brief = {
    people: null,
    contractor: { organization: 'А' },
    customer: { organization: 'Б' },
    risks: { height: 'unknown', lifting: 'unknown' },
  };
  const result = applyProposals({ objectAddress: 'Старый адрес' }, brief, [p]);
  assert.equal(result.objectAddress, 'Улица 1');
  assert.equal(result.brief.people, null);
  assert.equal(brief.risks.height, 'unknown');
  assert.equal(fieldValue(result, result.brief, 'brief.people'), '');
  assert.throws(() =>
    applyProposals({}, brief, [{ ...p, field: 'brief.people', value: '-1' }]),
  );
  assert.equal(PPR_MODEL, 'gpt-5.6-sol');
  assert.deepEqual(readPprWorkspace(undefined), {
    analyses: [],
    versions: [],
    experience: [],
  });
  assert.deepEqual(
    confirmedExperience({
      experience: [{ confirmedAt: null, rule: 'Не подтверждено', changes: [] }],
    }),
    [],
  );
});
test('Visual QA fixture can be assembled by the same application module', async () => {
  let bytes;
  try {
    bytes = await readFile('work/word-qa/template.docx');
  } catch {
    return;
  }
  const info = inspectDocx(bytes);
  const output = assembleDocx(bytes, [
    {
      start: info.paragraphs.find((p) => p.text === '1 Общие положения').id,
      end: info.paragraphs.find((p) => p.text === '2 Организация работ').id,
      paragraphs: [
        {
          text: 'Новый текст раздела. Проверка синего шрифта и сохранения исходного оформления шаблона. Это синтетический пример, не готовый ППР.',
          changed: true,
        },
      ],
    },
  ]);
  await writeFile('work/word-qa/assembled.docx', output);
});
