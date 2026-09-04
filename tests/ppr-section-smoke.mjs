import { ntdSmoke } from './ntd-smoke.mjs';
// Runs the built application in isolation. Only synthetic fixtures and a loopback
// model response are used: no Supabase, original documents or paid model requests.
import assert from 'node:assert/strict';
import { workspaceSmoke } from './ppr-workspace-smoke.mjs';
import { sourceFilesSmoke } from './ppr-source-files-smoke.mjs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const fixturesRoot = resolve('work', 'test-fixtures');
await mkdir(fixturesRoot, { recursive: true });
const fixture = await mkdtemp(join(fixturesRoot, 'ppr-'));
const library = join(fixture, 'library');
const index = join(fixture, 'index');
await Promise.all([mkdir(library), mkdir(join(index, 'texts'), { recursive: true })]);
const source = 'Порядок организации работ определяется паспортом проекта.';
const unselected = 'UNSELECTED_FRAGMENT_DO_NOT_SEND';
const documentText = `${source}\n\n${unselected}`;
const fileBytes = Buffer.from('Synthetic fixture, not a real DOCX');
const sha = value => createHash('sha256').update(value).digest('hex');
await writeFile(join(library, 'template.docx'), fileBytes);
await writeFile(join(index, 'texts', 'template.txt'), documentText);
await writeFile(join(index, 'manifest.json'), JSON.stringify({ schema: 'orbit-local-template-index-v1', files: [
  { path: 'template.docx', name: 'template.docx', extension: '.docx', sha256: sha(fileBytes), state: 'indexed', textFile: 'texts/template.txt', characters: documentText.length, headings: [] },
] }));

const modelRequests = [];
let failModel = false;
let workspaceOutput = null;
const provider = createServer(async (req, res) => {
  if (req.url !== '/v1/responses') { res.writeHead(404).end(); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  modelRequests.push(JSON.parse(Buffer.concat(chunks).toString()));
  if (failModel) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'PRIVATE_PROVIDER_ERROR_MARKER', type: 'invalid_request_error' } })); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
    id: `resp_${randomUUID()}`, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model: 'gpt-4o-mini',
    output: [{ id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(workspaceOutput || (JSON.stringify(modelRequests.at(-1).input).includes('previousDialogue') ? { overview: 'Нужно уточнить условия площадки.', readiness: 'needs_data', sections: [], missingInformation: [], questions: ['Уточните численность.'], handoffs: [], warnings: [] } : { paragraphs: [source, 'Уточнить исходные данные учебного объекта.'], questions: ['Уточнить перечень работ.'], warnings: [] })), annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  }));
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise(resolveClose => portProbe.close(resolveClose));
// NextURL normalizes loopback hosts to localhost; use its canonical same origin.
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_ANON_KEY: '',
    OPENAI_API_KEY: 'fixture-only-not-a-real-key', OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
    OPENAI_AGENT_MODEL: 'gpt-4o-mini', OPENAI_AGENTS_DISABLE_TRACING: '1',
    ORBIT_LOCAL_FILES_ROOT: library, ORBIT_LOCAL_INDEX_ROOT: index,
  },
});
let serverLog = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverLog = (serverLog + chunk.toString()).slice(-10000); });
const headers = { 'X-Orbit-Client': 'dashboard', 'Content-Type': 'application/json', Origin: base };
async function api(path, { method = 'GET', data, status = 200, overrideHeaders } = {}) {
  const options = { method, headers: overrideHeaders || headers };
  if (data !== undefined) options.body = JSON.stringify(data);
  const response = await fetch(`${base}${path}`, options);
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
const create = (description, directionId = 'work-ppr') => api('/api/tasks', { method: 'POST', status: 201, data: {
  id: randomUUID(), description, sphere: 'work', directionId, dueDate: null, dueTime: null, durationMinutes: 60, waitingFor: '', queue: 1, priority: 'medium',
} });
const project = { documentType: 'ppr', objectName: 'Учебный объект', objectAddress: '', customer: '', responsible: '', stage: 'drafting',
  developmentMode: 'without_tk', workType: 'Подготовительные работы', baseTemplatePath: 'template.docx', scheduleSource: 'contractor',
  hasWorkAtHeight: false, hasLiftingStructures: false, usesTowerCrane: false, hasMonolithicWork: false, documents: [], checklist: [], brief: { code: 'ППР-ТЕСТ', title: 'Учебный ППР', methods: 'Тестовый метод', workingFolder: 'PRIVATE_FOLDER_DO_NOT_SEND' } };
try {
  let ready = false;
  let readinessStatus = '';
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${serverLog}`);
    try {
      const response = await fetch(`${base}/api/tasks`, { headers });
      readinessStatus = `${response.status} ${await response.text()}`; ready = response.ok;
    } catch { /* Server is starting. */ }
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, `Test server did not become ready: ${readinessStatus}\n${serverLog}`);
  await api('/api/work-templates', { status: 403, overrideHeaders: {} });
  await api('/api/work-templates', { status: 403, overrideHeaders: { ...headers, Origin: 'https://untrusted.example' } });
  const list = await api('/api/work-templates');
  assert.equal(list.enabled, true); assert.equal(list.configured, true); assert.equal(list.templates.length, 1);
  await api('/api/work-templates?path=..%2Foutside.docx', { status: 403 });
  const { preview } = await api('/api/work-templates?path=template.docx');
  assert.equal(preview.chunks.length, 2);
  let { task } = await create('Создать раздел для учебного проекта');
  const unrelated = (await create('OTHER_TASK_DO_NOT_SEND', 'work-lab')).task;
  ({ task } = await api(`/api/tasks/${task.id}`, { method: 'PATCH', data: { op: 'edit_work_project', revision: task.revision, project } }));
  await ntdSmoke(api);
  task = await sourceFilesSmoke({ api, task, library, fixture, unrelatedId: unrelated.id });
  project.sourceFolderUrl = task.workProject.sourceFolderUrl;
  const input = () => ({ taskId: task.id, revision: task.revision, sectionId: 'general', templatePath: preview.path, textHash: preview.textHash, sourceHash: preview.sourceHash, chunkIds: ['fragment-1'], confirmDataTransfer: true });
  const generate = (data = input(), status = 200) => api('/api/agents/ppr-section', { method: 'POST', data, status });
  const brief = (op = 'approve', status = 200, extra = {}) => api(`/api/tasks/${task.id}/work-brief`, { method: 'POST', status, data: { op, revision: task.revision, confirm: true, acknowledgeOpenQuestions: true, ...extra } });
  await generate(input(), 409);
  await brief('approve', 400, { confirm: false });
  await brief('approve', 400, { acknowledgeOpenQuestions: false });
  await brief('approve', 409, { revision: task.revision - 1 });
  ({ task } = await brief());
  await brief('approve', 409);
  await brief('prepare_tk', 409);
  await generate({ ...input(), confirmDataTransfer: false }, 400);
  await generate({ ...input(), taskId: unrelated.id, revision: unrelated.revision }, 409);
  await generate({ ...input(), sectionId: 'graphics' }, 400);
  await generate({ ...input(), revision: task.revision - 1 }, 409);
  await generate({ ...input(), textHash: '0'.repeat(64) }, 409);
  await generate({ ...input(), chunkIds: ['fragment-999'] }, 400);
  await generate({ ...input(), chunkIds: Array.from({ length: 9 }, (_, i) => `fragment-${i + 1}`) }, 400);
  await generate({ ...input(), templatePath: 'other.docx' }, 409);
  await generate({ ...input(), taskId: randomUUID() }, 404);
  assert.equal(modelRequests.length, 0, 'Rejected requests must not call the model.');
  const { draft } = await generate();
  assert.equal(modelRequests.length, 1);
  assert.equal(modelRequests[0].store, false);
  const sent = JSON.stringify(modelRequests[0]);
  assert.ok(sent.includes(source));
  for (const forbidden of [unselected, unrelated.description, 'fixture-only-not-a-real-key', library, 'PRIVATE_FOLDER_DO_NOT_SEND', 'PRIVATE_LINK_DO_NOT_SEND']) assert.ok(!sent.includes(forbidden), `Unexpected input: ${forbidden}`);
  assert.ok(sent.includes('Тестовый метод'));
  assert.equal(draft.paragraphs[0].changed, false);
  assert.equal(draft.paragraphs[1].changed, true);
  const save = (data, status = 201) => api(`/api/tasks/${task.id}/ppr-drafts`, { method: 'POST', data, status });
  const saveInput = { draft, revision: task.revision, confirmSave: true };
  await save({ ...saveInput, confirmSave: false }, 400);
  await save({ ...saveInput, draft: { ...draft, taskId: unrelated.id } }, 409);
  await save({ ...saveInput, draft: { ...draft, sources: [{ id: 'fragment-1', text: 'Подменённый исходный текст' }] } }, 409);
  await save({ ...saveInput, revision: task.revision - 1 }, 409);
  draft.paragraphs[1] = { text: 'Правка инженера для учебного объекта.', changed: false };
  ({ task } = await save(saveInput));
  assert.equal(task.pprDrafts[0].version, 1);
  assert.equal(task.pprDrafts[0].paragraphs[1].changed, true, 'Server must recompute blue marking.');
  await save(saveInput, 409);
  const reloaded = (await api('/api/tasks')).tasks.find(item => item.id === task.id);
  assert.deepEqual(reloaded.pprDrafts, task.pprDrafts);
  assert.deepEqual(reloaded.briefApprovals, task.briefApprovals);
  ({ task } = await api(`/api/tasks/${task.id}`, { method: 'PATCH', data: { op: 'edit_work_project', revision: task.revision, project: { ...project, responsible: 'Учебный инженер' } } }));
  assert.equal(task.pprDrafts.length, 1, 'Passport edits must preserve draft history.');
  assert.equal(task.briefApprovals.length, 1, 'Editing must preserve the previous brief snapshot.');
  await generate(input(), 409);
  ({ task } = await brief());
  assert.equal(task.briefApprovals.length, 2);
  const second = (await generate()).draft;
  ({ task } = await save({ draft: second, revision: task.revision, confirmSave: true }));
  assert.deepEqual(task.pprDrafts.map(item => item.version), [1, 2]);
  assert.equal(task.pprDrafts[0].paragraphs[1].text, draft.paragraphs[1].text, 'Saving v2 must not overwrite v1.');
  const chatData = { taskId: task.id, revision: task.revision, question: 'Что нужно уточнить?', dialogue: [], confirmDataTransfer: true };
  await api('/api/agents/ppr-developer', { method: 'POST', data: { ...chatData, question: 'a'.repeat(2001) }, status: 400 });
  await api('/api/agents/ppr-developer', { method: 'POST', data: { ...chatData, revision: 0 }, status: 409 });
  const chat = await api('/api/agents/ppr-developer', { method: 'POST', data: chatData });
  assert.ok(chat.result.overview.includes('площадки')); assert.ok(chat.result.sections.length > 0);
  assert.ok(!JSON.stringify(modelRequests.at(-1)).includes('PRIVATE_FOLDER_DO_NOT_SEND'));
  ({ task } = await api(`/api/tasks/${task.id}`, { method: 'PATCH', data: { op: 'edit_work_project', revision: task.revision, project: { ...task.workProject, developmentMode: 'with_tk', brief: { ...task.workProject.brief, tkList: ['ТК земляные', 'ТК монолит'] } } } }));
  await brief('prepare_tk', 409);
  ({ task } = await brief());
  ({ task } = await brief('prepare_tk'));
  assert.equal(task.tkAssignments.length, 2);
  assert.equal(task.tkAssignments[0].status, 'prepared');
  assert.equal(task.tkAssignments[0].executor, 'tk_developer');
  await brief('prepare_tk', 409);
  ({ task } = await api(`/api/tasks/${task.id}`, { method: 'PATCH', data: { op: 'edit_work_project', revision: task.revision, project: { ...task.workProject, stage: 'structure' } } }));
  await brief('approve', 409); // stage-only change does not require a new approval
  assert.equal(task.tkAssignments.length, 2); assert.equal(task.pprDrafts.length, 2);
  const afterTk = (await api('/api/tasks')).tasks.find(v => v.id === task.id);
  assert.deepEqual(afterTk.tkAssignments, task.tkAssignments);
  task = await workspaceSmoke({ api, task, setOutput: value => { workspaceOutput = value; }, modelRequests });
  // Full manual brief survives a separate read; a stale tab cannot replace it.
  let persistenceTask = (await create('Проверка сохранения полного ТЗ')).task;
  const fullProject = { ...project, objectAddress: 'Учебный адрес', developmentMode: 'with_tk',
    brief: { ...task.workProject.brief, code: 'ППР-СОХРАНЕНИЕ-1', title: 'Полное учебное ТЗ',
      methods: 'Монтаж последовательно по захваткам', people: 12, equipment: 'Учебный перечень техники',
      siteInstructions: 'Учебные проезды и ограждения', contractorInput: 'Работа в две смены',
      additional: 'Согласовать доступ', crew: 'Два звена', scheduleNotes: 'Учебный график',
      schedules: ['Производство работ', 'Движение техники'], tkList: ['ТК монтаж', 'ТК земляные работы'],
      contractor: { organization: 'Учебный подрядчик', position: 'Директор', fullName: 'Иванов Иван Иванович', authority: 'Устав' },
      customer: { organization: 'Учебный заказчик', position: '', fullName: '', authority: '' },
      risks: { height: 'no', lifting: 'no', fire: 'yes', electrical: 'yes', confined: 'unknown' },
    } };
  const oldRevision = persistenceTask.revision;
  ({ task: persistenceTask } = await api(`/api/tasks/${persistenceTask.id}`, { method: 'PATCH', data: {
    op: 'edit_work_project', revision: oldRevision, project: fullProject,
  } }));
  assert.deepEqual(persistenceTask.workProject.brief, fullProject.brief);
  const readPersisted = async () => (await api('/api/tasks')).tasks.find(t => t.id === persistenceTask.id);
  assert.deepEqual((await readPersisted()).workProject, persistenceTask.workProject);
  await api(`/api/tasks/${persistenceTask.id}`, { method: 'PATCH', status: 409, data: {
    op: 'edit_work_project', revision: oldRevision, project,
  } });
  assert.deepEqual((await readPersisted()).workProject, persistenceTask.workProject);
  console.log('PASS: all manual brief fields survive save/read; stale-tab overwrite is rejected.');
  failModel = true;
  const providerFailure = await generate(input(), 502);
  assert.ok(!JSON.stringify(providerFailure).includes('PRIVATE_PROVIDER_ERROR_MARKER'));
  assert.ok(!serverLog.includes('PRIVATE_PROVIDER_ERROR_MARKER'), 'Provider details must not enter app logs.');
  assert.equal(sha(await readFile(join(library, 'template.docx'))), preview.sourceHash, 'App must not modify originals.');
  await writeFile(join(library, 'template.docx'), 'Changed synthetic source');
  await generate(input(), 409);
  await api('/api/work-templates?path=template.docx', { status: 409 });
  console.log('PASS: API consent, access, limits, provenance, isolated SDK call, edit/save/reload, two versions, conflicts, stale sources and safe errors.');
} finally {
  if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
  provider.closeAllConnections();
  await new Promise(resolveClose => provider.close(resolveClose));
}
