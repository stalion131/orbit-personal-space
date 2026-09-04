import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractTkProposals,
  verifiedProposals,
  applyProposals,
  proposalKey,
} from '../lib/ppr-workspace.ts';
import { readWorkBrief, briefIssues } from '../lib/work-brief.ts';
import { sourceFolderIssue } from '../lib/work-sources.ts';
test('Contract TK retains individual citations, preserves manual list and deduplicates', () => {
  const files = [
    {
      hash: 'a'.repeat(64),
      purpose: 'ppr_contract',
      blocks: [
        { id: 'p1', text: 'ТК №1 - Монтаж;\nТK №2 - Демонтаж.' },
        { id: 'p2', text: 'Не разрабатываем расчёты.' },
      ],
    },
  ];
  const proposals = verifiedProposals(contractTkProposals(files), files);
  assert.equal(proposals.length, 2);
  assert.notEqual(proposalKey(proposals[0]), proposalKey(proposals[1]));
  const project = { brief: readWorkBrief({ tkList: ['Ручная карта'] }) };
  const result = applyProposals(project, project.brief, proposals);
  assert.deepEqual(result.brief.tkList, [
    'Ручная карта',
    'ТК №1 - Монтаж',
    'ТK №2 - Демонтаж',
  ]);
  assert.deepEqual(
    applyProposals(result, result.brief, proposals).brief.tkList,
    result.brief.tkList,
  );
  assert.equal(
    contractTkProposals([{ ...files[0], purpose: 'construction_contract' }])
      .length,
    0,
  );
  assert.equal(
    verifiedProposals([{ ...proposals[0], value: 'Выдуманная ТК' }], files)
      .length,
    0,
  );
});
test('Local paths receive actionable link errors without allowing insecure URLs', () => {
  assert.match(sourceFolderIssue('D:\\Projects\\Site'), /Рабочая папка/);
  assert.match(sourceFolderIssue('file:///D:/Site'), /локальный путь/);
  assert.ok(sourceFolderIssue('http://example.com'));
  assert.ok(sourceFolderIssue('https://user:pass@example.com'));
  assert.equal(sourceFolderIssue('https://example.com/folder'), '');
  assert.equal(sourceFolderIssue(''), '');
});
test('Approval keeps mandatory requirements for with-TK projects', () => {
  const p = {
    objectName: 'Объект',
    workType: 'Ремонт',
    documentType: 'ppr',
    developmentMode: 'with_tk',
    brief: readWorkBrief({ code: 'ППР-1', title: 'ППР' }),
  };
  assert.deepEqual(briefIssues(p), ['Добавьте хотя бы одну ТК.']);
  assert.deepEqual(
    briefIssues({
      ...p,
      brief: readWorkBrief({ ...p.brief, tkList: ['ТК №1 - Монтаж'] }),
    }),
    [],
  );
});

test('Autofill preserves manual values, fills unknowns and retains proof without approving', async () => {
  const { autoFillProposals } = await import('../lib/ppr-workspace.ts');
  const p = {
    objectName: 'Мой объект',
    developmentMode: 'undecided',
    brief: readWorkBrief({ methods: 'Мой метод', tkList: ['Моя ТК'] }),
  };
  const make = (field, value) => ({
    field,
    value,
    fileHash: 'a'.repeat(64),
    blockId: 'p1',
    quote: value,
    reason: 'Источник',
  });
  const r = autoFillProposals(p, [
    make('objectName', 'Иной объект'),
    make('brief.methods', 'Иной метод'),
    make('brief.equipment', 'Кран'),
    make('brief.people', '12'),
    make('brief.tkList', 'ТК №2 - Монтаж'),
    make('developmentMode', 'with_tk'),
    make('brief.customer.fullName', 'Имя без должности'),
  ]);
  assert.equal(r.project.objectName, 'Мой объект');
  assert.equal(r.project.brief.methods, 'Мой метод');
  assert.equal(r.project.brief.equipment, 'Кран');
  assert.equal(r.project.brief.people, 12);
  assert.deepEqual(r.project.brief.tkList, ['Моя ТК', 'ТК №2 - Монтаж']);
  assert.equal(r.project.developmentMode, 'with_tk');
  assert.equal(r.project.brief.customer.fullName, '');
  assert.equal(r.applied.length, 4);
  assert.equal(p.brief.equipment, '');
});
