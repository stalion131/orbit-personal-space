import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { pdfFixture } from './pdf-fixture.mjs';
import { xlsxFixture } from './xlsx-fixture.mjs';

export async function workspaceSmoke({ api, task, setOutput, modelRequests }) {
  const path = `/api/tasks/${task.id}/ppr-workspace`;
  const call = (op, data = {}, status = 201) =>
    api(path, {
      method: 'POST',
      status,
      data: { op, revision: task.revision, ...data },
    });
  const wire = (name, bytes) => ({
    name,
    base64: Buffer.from(bytes).toString('base64'),
  });
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  await api(path, { status: 403, overrideHeaders: {} });
  await api(`/api/tasks/${randomUUID()}/ppr-workspace`, { status: 404 });
  assert.equal((await api(path)).model, 'gpt-5.6-sol');
  assert.equal((await api(path)).sourcePolicy, 'read-only-no-persistent-copy');
  await api('/api/agents/ppr-status', { status: 403, overrideHeaders: {} });
  await api('/api/agents/ppr-status', {
    method: 'POST',
    data: { confirmConnection: false },
    status: 400,
  });
  setOutput({ ok: true });
  assert.equal(
    (
      await api('/api/agents/ppr-status', {
        method: 'POST',
        data: { confirmConnection: true },
      })
    ).connected,
    true,
  );
  assert.ok(!JSON.stringify(modelRequests.at(-1)).includes(task.title));
  setOutput(null);
  const beforeTkCalls = modelRequests.length;
  const contract = wire(
    'contract.txt',
    Buffer.from('ТК №1 - Монтаж;\nТK №2 - Демонтаж.'),
  );
  ({ task } = await call('extract_tk', {
    files: [{ ...contract, purpose: 'ppr_contract' }],
  }));
  const tkAnalysis = task.pprWorkspace.analyses.at(-1);
  assert.equal(tkAnalysis.method, 'contract_tk');
  assert.equal(tkAnalysis.proposals.length, 2);
  assert.equal(
    modelRequests.length,
    beforeTkCalls,
    'No model call for explicit TK extraction',
  );
  const beforeTk = task.workProject.brief.tkList;
  ({ task } = await call('apply', {
    analysisId: tkAnalysis.id,
    fields: tkAnalysis.proposals.map((p) => `${p.field}:${p.value}`),
  }));
  assert.deepEqual(task.workProject.brief.tkList, [
    ...new Set([...beforeTk, 'ТК №1 - Монтаж', 'ТK №2 - Демонтаж']),
  ]);
  const autoContract = wire(
    'auto-contract.txt',
    Buffer.from('ТК №3 - Автоматическое добавление;'),
  );
  const existingMethods = task.workProject.brief.methods;
  ({ task } = await call('extract_tk', {
    files: [{ ...autoContract, purpose: 'ppr_contract' }],
    autoFill: true,
  }));
  assert.ok(
    task.workProject.brief.tkList.includes('ТК №3 - Автоматическое добавление'),
  );
  assert.equal(task.workProject.brief.methods, existingMethods);
  assert.equal(task.pprWorkspace.analyses.at(-1).applied.length, 1);
  assert.equal(modelRequests.length, beforeTkCalls);
  const documentsBeforeRepeat = structuredClone(task.workProject.documents);
  const sourceBeforeRepeat = JSON.stringify(autoContract);
  ({ task } = await call('extract_tk', {
    files: [
      { ...autoContract, purpose: 'ppr_contract' },
      { ...autoContract, name: 'renamed-copy.txt', purpose: 'ppr_contract' },
    ],
    autoFill: true,
  }));
  assert.deepEqual(task.workProject.documents, documentsBeforeRepeat,
    'Repeat/renamed source must not duplicate or alter the registry');
  assert.equal(task.pprWorkspace.analyses.at(-1).files.length, 1);
  assert.equal(JSON.stringify(autoContract), sourceBeforeRepeat);
  assert.equal(modelRequests.length, beforeTkCalls);
  await call('extract_tk', {
    files: [
      { ...autoContract, purpose: 'ppr_contract' },
      { ...autoContract, purpose: 'construction_contract' },
    ],
  }, 400);
  const readBack = (await api('/api/tasks')).tasks.find((t) => t.id === task.id);
  assert.deepEqual(readBack.workProject.documents, task.workProject.documents,
    'Full hash IDs must survive repository hydration');
  const legacyDocuments = task.workProject.documents.map((d) => ({ ...d, id: d.id.slice(0, 60) }));
  ({ task } = await api(`/api/tasks/${task.id}`, {
    method: 'PATCH',
    data: { op: 'edit_work_project', revision: task.revision,
      project: { ...task.workProject, documents: legacyDocuments } },
  }));
  ({ task } = await call('extract_tk', {
    files: [{ ...autoContract, name: 'another-name.txt', purpose: 'ppr_contract' }],
    autoFill: true,
  }));
  assert.deepEqual(task.workProject.documents, legacyDocuments,
    'Previously truncated IDs must be recognized without changing existing records');
  const pdf = await call(
    'inspect',
    { file: wire('source.pdf', pdfFixture()) },
    200,
  );
  assert.ok(
    pdf.file.blocks.some((b) => b.text.includes('SITE DATA 24')),
    'Digital PDF extraction must work in the built server.',
  );
  const source = wire(
    'source.txt',
    Buffer.from(
      'Адрес: Учебная улица, 1\nПодрядчик: генеральный директор Иванов Иван Иванович. Заказчик: Петров Пётр Петрович, должность не указана.',
    ),
  );
  const inspected = await call('inspect', { file: source }, 200);
  const excel = wire('volumes.xlsx', xlsxFixture());
  const table = await call('inspect', { file: excel }, 200);
  assert.equal(table.file.sheets.length, 2);
  assert.match(table.file.blocks[0].text, /B3: Монтаж кабеля/);
  assert.ok(table.file.warnings.some((w) => w.includes('Нет результата: 1')));
  const developer = wire(
    'developer-contract.txt',
    Buffer.from('Исполнитель: Разработчик ППР'),
  );
  const developerInfo = await call('inspect', { file: developer }, 200);
  const extra = Array.from({ length: 2 }, (_, i) =>
    wire(`source-${i}.txt`, Buffer.from(`Дополнение ${i}`)),
  );
  setOutput({
    proposals: [
      {
        field: 'brief.contractor.fullName',
        value: 'Иванов Иван Иванович',
        fileHash: inspected.file.hash,
        blockId: inspected.file.blocks[0].id,
        quote: 'генеральный директор Иванов Иван Иванович',
        reason: 'Руководитель по умолчанию, проверить полномочия',
      },
      {
        field: 'brief.contractor.position',
        value: 'Генеральный директор',
        fileHash: inspected.file.hash,
        blockId: inspected.file.blocks[0].id,
        quote: 'генеральный директор Иванов Иван Иванович',
        reason: 'Должность в документе',
      },
      {
        field: 'brief.customer.fullName',
        value: 'Петров Пётр Петрович',
        fileHash: inspected.file.hash,
        blockId: inspected.file.blocks[0].id,
        quote: 'Петров Пётр Петрович',
        reason: 'Имя без должности должно исключаться',
      },
      {
        field: 'objectAddress',
        value: 'Учебная улица, 1',
        fileHash: inspected.file.hash,
        blockId: inspected.file.blocks[0].id,
        quote: 'Адрес: Учебная улица, 1',
        reason: 'В исходном документе',
      },
      {
        field: 'workType',
        value: 'Придуманные работы',
        fileHash: inspected.file.hash,
        blockId: inspected.file.blocks[0].id,
        quote: 'Нет такой цитаты',
        reason: 'Неверно',
      },
      {
        field: 'brief.contractor.organization',
        value: 'Разработчик ППР',
        fileHash: developerInfo.file.hash,
        blockId: developerInfo.file.blocks[0].id,
        quote: 'Исполнитель: Разработчик ППР',
        reason: 'Перепутаны стороны',
      },
      {
        field: 'brief.additional',
        value: 'Монтаж кабеля',
        fileHash: table.file.hash,
        blockId: table.file.blocks[0].id,
        quote: 'B3: Монтаж кабеля',
        reason: 'Лист Объёмы, B3',
      },
    ],
    questions: ['Уточните численность.'],
    warnings: [],
  });
  const requestCount = modelRequests.length;
  await call('analyze', { files: [source] }, 400);
  await call(
    'analyze',
    { files: [{ ...source, purpose: 'invalid' }], confirmDataTransfer: true },
    400,
  );
  await call(
    'analyze',
    { files: [
      { ...source, purpose: 'ppr_contract' },
      { ...source, purpose: 'construction_contract' },
    ], confirmDataTransfer: true },
    400,
  );
  assert.equal(modelRequests.length, requestCount);
  const beforeAddress = task.workProject.objectAddress;
  ({ task } = await call('analyze', {
    files: [
      source,
      { ...excel, purpose: 'quantities' },
      { ...developer, purpose: 'ppr_contract' },
      ...extra,
    ],
    confirmDataTransfer: true,
  }));
  const analysis = task.pprWorkspace.analyses.at(-1);
  assert.equal(analysis.proposals.length, 4);
  assert.ok(
    !analysis.proposals.some((p) => p.field === 'brief.customer.fullName'),
  );
  assert.equal(analysis.files.length, 5);
  assert.equal(analysis.files[2].purpose, 'ppr_contract');
  assert.ok(analysis.warnings.some((w) => w.includes('Нет результата: 1')));
  assert.ok(
    !analysis.proposals.some(
      (p) => p.field === 'brief.contractor.organization',
    ),
  );
  assert.ok(JSON.stringify(modelRequests.at(-1)).includes('sheet-1-B3-F3:0'));
  assert.equal(
    task.workProject.objectAddress,
    beforeAddress,
    'Analysis must never silently overwrite manual fields.',
  );
  assert.equal(modelRequests.at(-1).model, 'gpt-5.6-sol');
  assert.equal(modelRequests.at(-1).reasoning.effort, 'medium');
  assert.equal(modelRequests.at(-1).store, false);
  assert.ok(
    !JSON.stringify(modelRequests.at(-1)).includes(
      'PRIVATE_FOLDER_DO_NOT_SEND',
    ),
  );
  assert.ok(
    !JSON.stringify(modelRequests.at(-1)).includes('PRIVATE_LINK_DO_NOT_SEND'),
  );
  await call('apply', { analysisId: analysis.id, fields: ['workType'] }, 400);
  await call(
    'apply',
    { analysisId: analysis.id, fields: ['brief.contractor.fullName'] },
    400,
  );
  ({ task } = await call('apply', {
    analysisId: analysis.id,
    fields: [
      'objectAddress',
      'brief.contractor.fullName',
      'brief.contractor.position',
    ],
  }));
  assert.equal(task.workProject.objectAddress, 'Учебная улица, 1');
  assert.equal(
    task.workProject.brief.contractor.fullName,
    'Иванов Иван Иванович',
  );
  assert.equal(
    task.workProject.brief.contractor.position,
    'Генеральный директор',
  );
  assert.equal(task.workProject.brief.customer.fullName, '');
  await call(
    'apply',
    { analysisId: analysis.id, fields: ['objectAddress'] },
    409,
  );
  setOutput(null);
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraph = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const template = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraph('1 Общие положения')}${paragraph('Порядок организации работ определяется паспортом проекта.')}${paragraph('2 Организация работ')}${paragraph('Не менять')}<w:sectPr/></w:body></w:document>`,
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}">${paragraph('Контрольный колонтитул')}</w:hdr>`,
    ),
  });
  const file = wire('base.docx', template);
  const templateInfo = await call('inspect', { file }, 200);
  const data = {
    file,
    sectionId: 'general',
    blocks: [templateInfo.file.blocks[1].id],
    confirmDataTransfer: true,
  };
  await call('generate', data, 409); // applying proposals invalidates prior approval
  ({ task } = await api(`/api/tasks/${task.id}/work-brief`, {
    method: 'POST',
    data: {
      op: 'approve',
      revision: task.revision,
      confirm: true,
      acknowledgeOpenQuestions: true,
    },
  }));
  await call('generate', { ...data, blocks: ['unknown'] }, 400);
  ({ task } = await call('generate', data));
  const draft = task.pprDrafts.at(-1);
  assert.equal(draft.briefId, task.briefApprovals.at(-1).id);
  const assembly = {
    file,
    sections: [{ draftId: draft.id, start: 'p-0', end: 'p-2' }],
    confirmAssembly: true,
  };
  await call('assemble', { ...assembly, confirmAssembly: false }, 400);
  const assembled = await call('assemble', assembly);
  task = assembled.task;
  const version = task.pprWorkspace.versions.at(-1);
  const bytes = Buffer.from(assembled.file.base64, 'base64');
  assert.equal(sha(bytes), version.hash);
  const parts = unzipSync(bytes);
  assert.deepEqual(
    parts['word/header1.xml'],
    unzipSync(template)['word/header1.xml'],
  );
  parts['word/document.xml'] = strToU8(
    strFromU8(parts['word/document.xml']).replace(
      'Уточнить исходные данные учебного объекта.',
      'Данные требуется запросить у подрядчика.',
    ),
  );
  const corrected = wire('corrected.docx', zipSync(parts));
  await call(
    'correct',
    { versionId: version.id, original: file, file: corrected },
    409,
  );
  ({ task } = await call('correct', {
    versionId: version.id,
    original: assembled.file,
    file: corrected,
  }));
  const experience = task.pprWorkspace.experience.at(-1);
  assert.equal(experience.confirmedAt, null);
  assert.equal(
    task.pprWorkspace.versions[0].hash,
    version.hash,
    'Original version must remain immutable.',
  );
  assert.ok(experience.changes.some((c) => c.after.includes('подрядчика')));
  const rule = 'EXPLICITLY_CONFIRMED_PPR_RULE';
  ({ task } = await call('confirm_experience', {
    experienceId: experience.id,
    indices: [0],
    rule,
  }));
  assert.ok(task.pprWorkspace.experience.at(-1).confirmedAt);
  await call(
    'confirm_experience',
    { experienceId: experience.id, indices: [0], rule },
    409,
  );
  ({ task } = await call('generate', data));
  assert.ok(
    JSON.stringify(modelRequests.at(-1)).includes(rule),
    'Confirmed project experience must reach SOL.',
  );
  const reloaded = (await api('/api/tasks')).tasks.find(
    (t) => t.id === task.id,
  );
  assert.deepEqual(reloaded.pprWorkspace, task.pprWorkspace);
  console.log(
    'PASS: SOL source citations, reviewed brief updates, DOCX assembly, corrected versions, confirmed experience, access and revision checks.',
  );
  return task;
}
