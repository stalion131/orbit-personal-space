import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ntdFixture } from './ntd-fixture.mjs';
import { importNtdRoadmap } from '../lib/ntd-import.ts';
import { readWorkBrief } from '../lib/work-brief.ts';
import { safeNtdUrl } from '../lib/ntd-types.ts';
test('Registry retains provenance and stable hash, rejects formulas and unsafe links', () => {
  const result = importNtdRoadmap('test.xlsx', ntdFixture());
  assert.equal(result.records.length, 1);
  assert.equal(result.permits[0].id, 'НД-01');
  assert.equal(result.records[0].row, 5);
  assert.equal(result.hash, importNtdRoadmap('test.xlsx', ntdFixture()).hash);
  assert.throws(
    () =>
      importNtdRoadmap(
        'test.xlsx',
        ntdFixture('<c r="B5"><f>1+1</f><v>2</v></c>'),
      ),
    /формул/,
  );
  assert.throws(
    () =>
      importNtdRoadmap(
        'test.xlsx',
        ntdFixture(
          '<c r="M5" t="inlineStr"><is><t>javascript:alert(1)</t></is></c>',
        ),
      ),
    /ссылка/,
  );
  assert.equal(safeNtdUrl('https://user:pass@example.com'), null);
  assert.throws(() => importNtdRoadmap('test.xls', ntdFixture()), /XLSX/);
});
test('Additional risk states round trip without changing legacy approvals or base conditions', () => {
  const old = readWorkBrief();
  assert.equal(Object.hasOwn(old, 'permitRisks'), false);
  const next = readWorkBrief({
    ...old,
    permitRisks: { 'НД-01': 'yes', 'НД-05': 'no', 'НД-31': 'unknown' },
  });
  assert.deepEqual(next.risks, old.risks);
  assert.deepEqual(readWorkBrief(next), next);
  assert.throws(() =>
    readWorkBrief({ ...old, permitRisks: { 'НД-99': 'yes' } }),
  );
  assert.throws(() =>
    readWorkBrief({ ...old, permitRisks: { 'НД-01': ['yes'] } }),
  );
});
