import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSourceFolderUrl,
  sourceBatchIssue,
  sourceFileIssue,
} from '../lib/work-sources.ts';

test('Folder links accept HTTPS references and reject credentials, active schemes and paths', () => {
  assert.equal(readSourceFolderUrl(undefined), '');
  assert.equal(
    readSourceFolderUrl('  https://example.org/project?view=files  '),
    'https://example.org/project?view=files',
  );
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,a',
    'file:///D:/docs',
    'D:\\docs',
    '//example.org',
    'http://example.org',
    'https://user:password@example.org',
    'https://example.org/\nfile',
    {},
    'https://example.org/' + 'a'.repeat(2000),
  ])
    assert.throws(() => readSourceFolderUrl(value));
});

test('Folder selection checks type, per-file and batch limits before reading content', () => {
  const file = (name, size = 100) => ({ name, size });
  assert.equal(
    sourceBatchIssue([file('project.DOCX'), file('rd.pdf'), file('notes.txt')]),
    '',
  );
  assert.ok(sourceFileIssue(file('plan.dwg')));
  assert.equal(sourceFileIssue(file('volumes.xlsx')), '');
  assert.match(sourceFileIssue(file('volumes.xls')), /XLSX/);
  assert.ok(sourceFileIssue(file('~$project.docx')));
  assert.ok(sourceFileIssue(file('empty.txt', 0)));
  assert.ok(sourceFileIssue(file('rd.pdf', 2_500_001)));
  assert.equal(sourceFileIssue(file('rd.pdf', 2_500_000)), '');
  assert.ok(sourceBatchIssue([]));
  assert.ok(
    sourceBatchIssue(Array.from({ length: 9 }, (_, i) => file(`${i}.txt`))),
  );
  assert.equal(
    sourceBatchIssue(Array.from({ length: 8 }, (_, i) => file(`${i}.xlsx`))),
    '',
  );
  assert.ok(
    sourceBatchIssue([file('1.pdf', 1_500_000), file('2.pdf', 1_400_000)]),
  );
  assert.equal(
    sourceBatchIssue([file('1.pdf', 1_400_000), file('2.pdf', 1_400_000)]),
    '',
  );
});
