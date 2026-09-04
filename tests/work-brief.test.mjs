import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  readWorkBrief,
  briefSnapshot,
  isBriefApproved,
  briefIssues,
  briefForAgent,
  readBriefApprovals,
  readTkAssignments,
} from '../lib/work-brief.ts';
import {
  buildPprSectionPlan,
  evaluatePprReadiness,
} from '../lib/ppr-methodology.ts';

const project = () => ({
  documentType: 'ppr',
  developmentMode: 'with_tk',
  objectName: 'Объект',
  objectAddress: '',
  customer: '',
  responsible: '',
  workType: 'Земляные работы',
  baseTemplatePath: 'ppr.docx',
  scheduleSource: 'draft',
  usesTowerCrane: false,
  hasMonolithicWork: false,
  hasWorkAtHeight: false,
  hasLiftingStructures: false,
  stage: 'source_data',
  documents: [],
  checklist: [],
  brief: readWorkBrief({
    code: 'ППР-1',
    title: 'Разработка ППР',
    tkList: ['Земляные работы'],
    workingFolder: 'C:\\internal',
  }),
});
const approval = (p) => ({
  id: randomUUID(),
  version: 1,
  at: '2026-09-04T10:00:00.000Z',
  snapshot: briefSnapshot(p),
});
test('Legacy flags are conservative; missing people and signatories are not invented', () => {
  const b = readWorkBrief(undefined, {
    hasWorkAtHeight: true,
    customer: 'Заказчик',
  });
  assert.equal(b.risks.height, 'yes');
  assert.equal(b.risks.lifting, 'unknown');
  assert.equal(b.people, null);
  assert.equal(b.customer.organization, 'Заказчик');
  assert.equal(b.customer.fullName, '');
  assert.equal(b.customer.position, '');
  assert.equal(b.contractor.position, '');
  assert.equal(b.contractor.authority, '');
  const p = project();
  assert.ok(
    buildPprSectionPlan(p)
      .find((v) => v.id === 'height')
      .note.includes('не определено'),
  );
  assert.ok(
    evaluatePprReadiness(p).appliedRules.some((v) =>
      v.includes('отсутствие не подтверждено'),
    ),
  );
  p.brief.risks.height = 'no';
  assert.ok(!buildPprSectionPlan(p).some((v) => v.id === 'height'));
});
test('Approval invalidates when input changes, while status and manual checks do not invalidate it', () => {
  const p = project(),
    task = { briefApprovals: [approval(p)] };
  assert.ok(isBriefApproved(task, p));
  assert.ok(
    isBriefApproved(task, {
      ...p,
      stage: 'drafting',
      sourceFolderUrl: 'https://example.org/project',
      checklist: [{ completed: true }],
      documents: [{ name: 'file' }],
    }),
  );
  assert.ok(
    !isBriefApproved(task, {
      ...p,
      brief: { ...p.brief, methods: 'Новый способ' },
    }),
  );
  assert.ok(!isBriefApproved(task, { ...p, baseTemplatePath: 'changed.docx' }));
  const restored = readBriefApprovals(
    JSON.parse(JSON.stringify(task.briefApprovals)),
  );
  assert.deepEqual(restored, task.briefApprovals);
  assert.ok(isBriefApproved({ briefApprovals: restored }, p));
});
test('Incomplete edits can render safely; server validation rejects invalid fields and duplicate TK', () => {
  const p = project();
  for (const patch of [
    { people: 0 },
    { people: 1.5 },
    { people: '5' },
    { people: 100001 },
    { tkList: [''] },
    { tkList: ['ТК', 'тк'] },
    { risks: { height: {} } },
    { methods: 'a'.repeat(3001) },
  ])
    assert.throws(() => readWorkBrief({ ...p.brief, ...patch }));
  assert.doesNotThrow(() =>
    briefSnapshot({ ...p, brief: { ...p.brief, tkList: [''] } }),
  );
  assert.ok(
    briefIssues({ ...p, brief: { ...p.brief, tkList: [''] } }).length > 0,
  );
  assert.ok(briefIssues({ ...p, brief: { ...p.brief, code: '' } }).length > 0);
  assert.ok(
    briefIssues({ ...p, brief: { ...p.brief, tkList: [] } }).length > 0,
  );
  assert.equal(
    briefIssues({ ...p, documentType: 'tk', brief: { ...p.brief, tkList: [] } })
      .length,
    0,
  );
});
test('Model context excludes working folder and keeps user instructions and distinct parties', () => {
  const p = project(),
    input = briefForAgent(p);
  assert.equal(input.workingFolder, undefined);
  assert.ok(!JSON.stringify(input).includes('internal'));
  assert.equal(input.title, p.brief.title);
  assert.notEqual(input.contractor, input.customer);
});
test('TK assignments must refer to an existing approved list; corrupt histories are rejected', () => {
  const p = project(),
    a = approval(p),
    assignment = {
      id: randomUUID(),
      title: 'Земляные работы',
      briefId: a.id,
      briefVersion: a.version,
      createdAt: a.at,
      status: 'prepared',
      executor: 'tk_developer',
    };
  assert.deepEqual(readTkAssignments([assignment], [a]), [assignment]);
  assert.throws(() =>
    readTkAssignments([{ ...assignment, title: 'Чужая карта' }], [a]),
  );
  assert.throws(() => readTkAssignments([assignment], []));
  assert.throws(() => readBriefApprovals([{ ...a, version: 2 }]));
  assert.throws(() => readBriefApprovals(Array(11).fill(a)));
  assert.deepEqual(readBriefApprovals(undefined), []);
  assert.deepEqual(readTkAssignments(undefined, []), []);
});
