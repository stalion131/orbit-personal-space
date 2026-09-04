import { hydratePprDrafts, type SavedPprDraft } from './ppr-drafts';
import { readPprWorkspace, type PprWorkspace } from './ppr-workspace';
import { readSourceFolderUrl } from './work-sources';
import { readWorkBrief, readBriefApprovals, readTkAssignments, type WorkBrief, type BriefApproval, type TkAssignment } from './work-brief';

export const statuses = {
  active: 'Активная', waiting: 'Ожидает действия со стороны', paused: 'Приостановлена',
  someday: 'До ситуации', completed: 'Завершена',
} as const;
export type Status = keyof typeof statuses;
const legacyStatuses: Record<string, Status> = { pending: 'active', running: 'active', approval: 'waiting', error: 'paused' };
export const priorities = ['low', 'medium', 'high', 'critical'] as const;
export type Priority = (typeof priorities)[number];
export type Sphere = { id: string; name: string; color: string; order: number };
export type Direction = { id: string; sphereId: string; name: string; order: number };
export type Catalog = { revision: number; spheres: Sphere[]; directions: Direction[] };

const sphereRows = [
  ['work', 'Работа', '#fc4c02'], ['personal', 'Личные задачи', '#a78bfa'],
  ['travel', 'Путешествия', '#38bdf8'], ['fitness', 'Тренировки и питание', '#22c55e'],
  ['health', 'Здоровье', '#14b8a6'], ['learning', 'Обучение и развитие', '#818cf8'],
  ['shopping', 'Покупки', '#f59e0b'], ['meetings', 'Встречи', '#f43f5e'],
] as const;
const directionRows = [
  ['work-lab', 'work', 'Лаборатория Комнатного'], ['work-build', 'work', 'Сфера строительства'],
  ['work-projects', 'work', 'Текущие проекты'], ['work-ppr', 'work', 'ППР'], ['personal-flat', 'personal', 'Квартира'],
  ['travel-search', 'travel', 'Поиск и бронирование билетов'], ['travel-routes', 'travel', 'Составление маршрутов'],
  ['travel-buy', 'travel', 'Покупка и бронирование билетов'],
] as const;
export const defaultCatalog: Catalog = {
  revision: 1,
  spheres: sphereRows.map(([id, name, color], order) => ({ id, name, color, order })),
  directions: directionRows.map(([id, sphereId, name], order) => ({ id, sphereId, name, order })),
};
export function withHealthSphere(catalog: Catalog): Catalog {
  if (catalog.spheres.some(item => item.id === 'health')) return catalog;
  return { ...catalog, spheres: [...catalog.spheres, { id: 'health', name: 'Здоровье', color: '#14b8a6', order: catalog.spheres.length }] };
}
export function withPprDirection(catalog: Catalog): Catalog {
  if (catalog.directions.some(item => item.sphereId === 'work' && item.name.trim().toLocaleLowerCase('ru') === 'ппр')) return catalog;
  return { ...catalog, directions: [...catalog.directions, { id: 'work-ppr', sphereId: 'work', name: 'ППР', order: catalog.directions.length }] };
}
export function legacyDirectionId(sphere: string, subcategory: string) {
  const name = subcategory === 'Сфера строительства / Текущие проекты' ? 'Текущие проекты' : subcategory;
  return defaultCatalog.directions.find(item => item.sphereId === sphere && item.name === name)?.id;
}

export type TaskEvent = { id: string; at: string; title: string; detail: string; actor: string };
export type Proposal = { id: string; title: string; body: string; recipient: string; cost: string; state: 'pending' | 'approved' | 'rejected'; decidedAt?: string };
export type Subtask = { id: string; title: string; dueDate: string | null; dueTime: string | null; completed: boolean; createdAt: string; completedAt: string | null };
export const workProjectStages = ['source_data', 'structure', 'drafting', 'ntd_review', 'approval'] as const;
export type WorkProjectStage = (typeof workProjectStages)[number];
export const workDocumentCategories = ['source', 'template', 'ntd', 'draft', 'final'] as const;
export type WorkDocumentCategory = (typeof workDocumentCategories)[number];
export const workDocumentStatuses = ['expected', 'available', 'review', 'approved'] as const;
export type WorkDocumentStatus = (typeof workDocumentStatuses)[number];
export const pprDevelopmentModes = ['undecided', 'with_tk', 'without_tk'] as const;
export type PprDevelopmentMode = (typeof pprDevelopmentModes)[number];
export const pprScheduleSources = ['unknown', 'contractor', 'draft'] as const;
export type PprScheduleSource = (typeof pprScheduleSources)[number];
export type WorkDocument = { id: string; name: string; category: WorkDocumentCategory; version: string; status: WorkDocumentStatus; updatedAt: string };
export type WorkChecklistItem = { id: string; title: string; completed: boolean };
export type WorkProject = {
  sourceFolderUrl?: string;
  brief?: WorkBrief;
  documentType: 'ppr' | 'tk'; objectName: string; objectAddress: string; customer: string; responsible: string; stage: WorkProjectStage;
  developmentMode: PprDevelopmentMode; workType: string; baseTemplatePath: string; scheduleSource: PprScheduleSource;
  hasWorkAtHeight: boolean; hasLiftingStructures: boolean; usesTowerCrane: boolean; hasMonolithicWork: boolean;
  documents: WorkDocument[]; checklist: WorkChecklistItem[];
};
export type Task = {
  pprWorkspace?: PprWorkspace;
  briefApprovals?: BriefApproval[]; tkAssignments?: TkAssignment[];
  id: string; title: string; description: string; sphere: string; directionId?: string; subcategory: string;
  dueDate: string | null; dueTime?: string | null; durationMinutes?: number; waitingFor?: string;
  queue: number; priority: Priority; focus: boolean; status: Status; demo: boolean; revision: number;
  createdAt: string; updatedAt: string; events: TaskEvent[]; subtasks: Subtask[]; workProject?: WorkProject; pprDrafts?: SavedPprDraft[]; result?: string; proposal?: Proposal;
};
export type Operation =
  | { op: 'complete' }
  | { op: 'focus'; value: boolean }
  | { op: 'defer'; value: boolean; waitingFor?: string }
  | { op: 'set_status'; status: Status; waitingFor?: string }
  | { op: 'edit'; description: string; sphere: string; directionId: string | null; dueDate: string | null; dueTime: string | null; durationMinutes: number; waitingFor: string; queue: number; priority: Priority }
  | { op: 'add_subtask'; id: string; title: string; dueDate: string | null; dueTime: string | null }
  | { op: 'edit_subtask'; id: string; title: string; dueDate: string | null; dueTime: string | null }
  | { op: 'toggle_subtask'; id: string; value: boolean }
  | { op: 'delete_subtask'; id: string }
  | { op: 'edit_work_project'; project: WorkProject }
  | { op: 'apply_agent_triage'; proposalId: string; nextAction: string; reason: string; dueDate: string | null; durationMinutes: number; priority: Priority; focus: boolean }
  | { op: 'decision'; proposalId: string; decision: 'approved' | 'rejected' };
export type CreateTaskInput = {
  id: string; description: string; sphere: string; directionId: string | null; dueDate: string | null;
  dueTime: string | null; durationMinutes: number; waitingFor: string; queue: number; priority: Priority;
};

export class TaskError extends Error { constructor(message: string, public status = 400) { super(message); } }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function isIsoDate(value: unknown) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
export function validDate(value: unknown) { return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)); }
export function validTime(value: unknown) { return value === null || (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)); }
export function validDuration(value: unknown) { return Number.isInteger(value) && Number(value) >= 5 && Number(value) <= 1440; }
export function normalizeStatus(value: unknown): Status { const text = String(value); return Object.hasOwn(statuses, text) ? text as Status : legacyStatuses[text] || 'active'; }
export function event(title: string, detail: string, actor = 'Система'): TaskEvent { return { id: crypto.randomUUID(), at: new Date().toISOString(), title, detail, actor }; }
function hydrateSubtasks(value: unknown): Subtask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || !candidate.title.trim() || !validDate(candidate.dueDate ?? null) || !validTime(candidate.dueTime ?? null)) return [];
    return [{ id: candidate.id, title: candidate.title.trim().slice(0, 300), dueDate: (candidate.dueDate as string | null) ?? null, dueTime: (candidate.dueTime as string | null) ?? null, completed: Boolean(candidate.completed), createdAt: isIsoDate(candidate.createdAt) ? candidate.createdAt as string : new Date().toISOString(), completedAt: isIsoDate(candidate.completedAt) ? candidate.completedAt as string : null }];
  });
}
function hydrateWorkProject(value: unknown): WorkProject | undefined {
  if (!isRecord(value)) return undefined;
  const documentType = value.documentType === 'tk' ? 'tk' : 'ppr';
  const stage = workProjectStages.includes(value.stage as WorkProjectStage) ? value.stage as WorkProjectStage : 'source_data';
  const developmentMode = pprDevelopmentModes.includes(value.developmentMode as PprDevelopmentMode) ? value.developmentMode as PprDevelopmentMode : 'undecided';
  const scheduleSource = pprScheduleSources.includes(value.scheduleSource as PprScheduleSource) ? value.scheduleSource as PprScheduleSource : 'unknown';
  const usesTowerCrane = Boolean(value.usesTowerCrane);
  const brief = readWorkBrief(value.brief, value as Partial<WorkProject>);
  if (usesTowerCrane) brief.risks.lifting = 'yes';
  const text = (field: string, limit: number) => typeof value[field] === 'string' ? String(value[field]).trim().slice(0, limit) : '';
  const documents = Array.isArray(value.documents) ? value.documents.flatMap(candidate => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || !candidate.name.trim()) return [];
    const category = workDocumentCategories.includes(candidate.category as WorkDocumentCategory) ? candidate.category as WorkDocumentCategory : 'source';
    const status = workDocumentStatuses.includes(candidate.status as WorkDocumentStatus) ? candidate.status as WorkDocumentStatus : 'expected';
    return [{ id: candidate.id.slice(0, 60), name: candidate.name.trim().slice(0, 180), category, version: typeof candidate.version === 'string' ? candidate.version.trim().slice(0, 40) : '', status, updatedAt: isIsoDate(candidate.updatedAt) ? candidate.updatedAt as string : new Date().toISOString() }];
  }).slice(0, 100) : [];
  const checklist = Array.isArray(value.checklist) ? value.checklist.flatMap(candidate => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || !candidate.title.trim()) return [];
    return [{ id: candidate.id.slice(0, 60), title: candidate.title.trim().slice(0, 180), completed: Boolean(candidate.completed) }];
  }).slice(0, 60) : defaultWorkChecklist();
  return {
    documentType, objectName: text('objectName', 240), objectAddress: text('objectAddress', 300), customer: text('customer', 200), responsible: text('responsible', 160), stage,
    developmentMode, workType: text('workType', 300), baseTemplatePath: text('baseTemplatePath', 1000), scheduleSource,
    hasWorkAtHeight: brief.risks.height === 'yes', hasLiftingStructures: brief.risks.lifting === 'yes', usesTowerCrane, hasMonolithicWork: Boolean(value.hasMonolithicWork),
    documents, checklist, brief, sourceFolderUrl: readSourceFolderUrl(value.sourceFolderUrl),
  };
}

export function defaultWorkChecklist(): WorkChecklistItem[] {
  return [
    { id: 'source-task', title: 'Получено техническое задание', completed: false },
    { id: 'source-drawings', title: 'Получены чертежи и исходные данные', completed: false },
    { id: 'source-schedule', title: 'Уточнены сроки и организация работ', completed: false },
    { id: 'source-responsible', title: 'Назначены ответственные лица', completed: false },
  ];
}
export function hydrateTask(task: Task): Task {
  const status = normalizeStatus(task.status);
  const pprDrafts = hydratePprDrafts(task.pprDrafts);
  task = { ...task, pprWorkspace: readPprWorkspace(task.pprWorkspace) };
  const briefApprovals = readBriefApprovals(task.briefApprovals);
  const tkAssignments = readTkAssignments(task.tkAssignments, briefApprovals);
  if (pprDrafts.some(draft => draft.taskId !== task.id)) throw new TaskError('Версия ППР относится к другому проекту.', 409);
  return { ...task, directionId: task.directionId || legacyDirectionId(task.sphere, task.subcategory), dueTime: task.dueTime ?? null,
    durationMinutes: validDuration(task.durationMinutes) ? task.durationMinutes : 60, waitingFor: typeof task.waitingFor === 'string' ? task.waitingFor : '',
    focus: Boolean(task.focus), status, subtasks: hydrateSubtasks(task.subtasks), workProject: hydrateWorkProject(task.workProject), pprDrafts, briefApprovals, tkAssignments };
}
export function orderedCatalog(catalog: Catalog): Catalog { return { ...catalog, spheres: [...catalog.spheres].sort((a, b) => a.order - b.order), directions: [...catalog.directions].sort((a, b) => a.order - b.order) }; }
export function normalizeCatalog(candidate: unknown): Catalog {
  if (!isRecord(candidate) || !Array.isArray(candidate.spheres) || !Array.isArray(candidate.directions) || !Number.isSafeInteger(candidate.revision)) throw new TaskError('Каталог сфер имеет неверный формат.');
  const sphereIds = new Set<string>();
  const spheres = candidate.spheres.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^[a-z0-9-]{3,60}$/.test(item.id) || sphereIds.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 48 || typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new TaskError(`Сфера ${index + 1} имеет неверные данные.`);
    sphereIds.add(item.id); return { id: item.id, name: item.name.trim(), color: item.color, order: index };
  });
  if (!spheres.length || spheres.length > 20) throw new TaskError('Нужно от 1 до 20 сфер.');
  const directionIds = new Set<string>();
  const directions = candidate.directions.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^[a-z0-9-]{3,60}$/.test(item.id) || directionIds.has(item.id) || !sphereIds.has(String(item.sphereId)) || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 60) throw new TaskError(`Направление ${index + 1} имеет неверные данные.`);
    directionIds.add(item.id); return { id: item.id, sphereId: String(item.sphereId), name: item.name.trim(), order: index };
  });
  return { revision: Number(candidate.revision), spheres, directions };
}
export function createTask(input: CreateTaskInput): Task {
  const now = new Date().toISOString(); const waitingFor = input.waitingFor.trim();
  return { id: input.id, title: input.description.split('\n')[0].slice(0, 110), description: input.description, sphere: input.sphere,
    directionId: input.directionId ?? undefined, subcategory: '', dueDate: input.dueDate, dueTime: input.dueTime, durationMinutes: input.durationMinutes,
    waitingFor, queue: input.queue, priority: input.priority, focus: false, demo: false, status: waitingFor ? 'someday' : 'active', revision: 1,
    createdAt: now, updatedAt: now, events: [event('Задача добавлена', waitingFor ? `Отложена до ситуации: ${waitingFor}` : 'Сохранена в вашем пространстве.', 'Вы')], subtasks: [] };
}
export function transition(task: Task, operation: Operation): Task {
  const next = structuredClone(hydrateTask(task));
  if (operation.op === 'complete') {
    if (task.status === 'completed') throw new TaskError('Задача уже завершена.', 409);
    next.status = 'completed'; next.events.push(event('Задача завершена', 'Вы отметили задачу выполненной.', 'Вы'));
  } else if (operation.op === 'focus') {
    next.focus = operation.value; next.events.push(event(operation.value ? 'Поставлена первой' : 'Убрана из первых', operation.value ? 'Задача будет показана первой в списке.' : 'Обычная очередность восстановлена.', 'Вы'));
  } else if (operation.op === 'defer') {
    const waitingFor = operation.waitingFor?.trim() || next.waitingFor || '';
    if (operation.value && !waitingFor) throw new TaskError('Укажите ситуацию, до которой отложить задачу.');
    next.waitingFor = operation.value ? waitingFor : ''; next.status = operation.value ? 'someday' : 'active';
    next.events.push(event(operation.value ? 'Перенесена во временное хранилище' : 'Возвращена в план', operation.value ? `До ситуации: ${waitingFor}` : 'Задача снова активна.', 'Вы'));
  } else if (operation.op === 'set_status') {
    const waitingFor = operation.waitingFor?.trim() || next.waitingFor || '';
    if (operation.status === 'someday' && !waitingFor) throw new TaskError('Укажите ситуацию для временного хранения.');
    next.status = operation.status; next.waitingFor = operation.status === 'someday' ? waitingFor : '';
    next.events.push(event('Статус изменён', statuses[operation.status], 'Вы'));
  } else if (operation.op === 'edit') {
    next.description = operation.description; next.title = operation.description.split('\n')[0].slice(0, 110); next.sphere = operation.sphere;
    next.directionId = operation.directionId ?? undefined; next.subcategory = ''; next.dueDate = operation.dueDate; next.dueTime = operation.dueTime;
    next.durationMinutes = operation.durationMinutes; next.waitingFor = next.status === 'someday' ? operation.waitingFor.trim() : ''; next.queue = operation.queue; next.priority = operation.priority;
    if (next.status === 'someday' && !next.waitingFor) next.status = 'active';
    next.events.push(event('Задача отредактирована', 'Изменены свойства задачи.', 'Вы'));
  } else if (operation.op === 'add_subtask') {
    if (next.subtasks.length >= 100) throw new TaskError('В одной задаче можно хранить до 100 этапов.');
    if (next.subtasks.some(item => item.id === operation.id)) throw new TaskError('Такой этап уже существует.', 409);
    const now = new Date().toISOString();
    next.subtasks.push({ id: operation.id, title: operation.title.trim(), dueDate: operation.dueDate, dueTime: operation.dueTime, completed: false, createdAt: now, completedAt: null });
    next.events.push(event('Добавлен этап', operation.dueDate ? `${operation.title.trim()} — ${operation.dueDate}${operation.dueTime ? `, ${operation.dueTime}` : ''}` : operation.title.trim(), 'Вы'));
  } else if (operation.op === 'edit_subtask') {
    const item = next.subtasks.find(subtask => subtask.id === operation.id);
    if (!item) throw new TaskError('Этап не найден.', 404);
    Object.assign(item, { title: operation.title.trim(), dueDate: operation.dueDate, dueTime: operation.dueTime });
    next.events.push(event('Этап изменён', operation.title.trim(), 'Вы'));
  } else if (operation.op === 'toggle_subtask') {
    const item = next.subtasks.find(subtask => subtask.id === operation.id);
    if (!item) throw new TaskError('Этап не найден.', 404);
    item.completed = operation.value; item.completedAt = operation.value ? new Date().toISOString() : null;
    next.events.push(event(operation.value ? 'Этап выполнен' : 'Этап возвращён в работу', item.title, 'Вы'));
  } else if (operation.op === 'delete_subtask') {
    const item = next.subtasks.find(subtask => subtask.id === operation.id);
    if (!item) throw new TaskError('Этап не найден.', 404);
    next.subtasks = next.subtasks.filter(subtask => subtask.id !== operation.id);
    next.events.push(event('Этап удалён', item.title, 'Вы'));
  } else if (operation.op === 'edit_work_project') {
    next.workProject = hydrateWorkProject(operation.project);
    if (!next.workProject) throw new TaskError('Проверьте карточку рабочего проекта.');
    next.events.push(event('Карточка проекта обновлена', `${next.workProject.documentType === 'ppr' ? 'ППР' : 'ТК'} · ${next.workProject.objectName || next.title}`, 'Вы'));
  } else if (operation.op === 'apply_agent_triage') {
    if (next.subtasks.length >= 100) throw new TaskError('В одной задаче можно хранить до 100 этапов.');
    if (next.subtasks.some(item => item.id === operation.proposalId)) throw new TaskError('Это предложение ИИ уже применено.', 409);
    const nextAction = operation.nextAction.trim();
    const now = new Date().toISOString();
    next.subtasks.push({ id: operation.proposalId, title: nextAction, dueDate: operation.dueDate, dueTime: null, completed: false, createdAt: now, completedAt: null });
    next.durationMinutes = operation.durationMinutes; next.priority = operation.priority; next.focus = operation.focus;
    next.events.push(event('Подзадача предложена ИИ', `${nextAction}${operation.dueDate ? ` — ${operation.dueDate}` : ''}\nПочему: ${operation.reason}`, 'ИИ-разбор задач'));
  } else throw new TaskError('Подтверждения агентов ещё не подключены.', 409);
  next.revision += 1; next.updatedAt = new Date().toISOString(); return next;
}
export function parseBackup(value: unknown): Task[] {
  if (!isRecord(value) || !Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length > 500) throw new TaskError('Выберите резервную копию Orbit с задачами.');
  const ids = new Set<string>();
  return value.tasks.map((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || ids.has(candidate.id) || typeof candidate.title !== 'string' || typeof candidate.description !== 'string' || !candidate.description.trim() || typeof candidate.sphere !== 'string' || typeof candidate.subcategory !== 'string' || !validDate(candidate.dueDate) || !Number.isInteger(candidate.queue) || !priorities.includes(candidate.priority as Priority) || (!Object.hasOwn(statuses, String(candidate.status)) && !Object.hasOwn(legacyStatuses, String(candidate.status))) || !isIsoDate(candidate.createdAt) || !isIsoDate(candidate.updatedAt) || !Array.isArray(candidate.events)) throw new TaskError(`Задача ${index + 1} не прошла проверку.`);
    ids.add(candidate.id); return hydrateTask({ ...candidate, demo: false } as Task);
  });
}
