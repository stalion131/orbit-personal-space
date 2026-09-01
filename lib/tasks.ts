export const statuses = {
  running: 'В работе', approval: 'Ждёт решения', error: 'Требует внимания',
  pending: 'Запланировано', someday: 'До ситуации', completed: 'Завершено',
} as const;
export type Status = keyof typeof statuses;
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
  ['work-projects', 'work', 'Текущие проекты'], ['personal-flat', 'personal', 'Квартира'],
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
export function legacyDirectionId(sphere: string, subcategory: string) {
  const name = subcategory === 'Сфера строительства / Текущие проекты' ? 'Текущие проекты' : subcategory;
  return defaultCatalog.directions.find(item => item.sphereId === sphere && item.name === name)?.id;
}

export type TaskEvent = { id: string; at: string; title: string; detail: string; actor: string };
export type Proposal = { id: string; title: string; body: string; recipient: string; cost: string; state: 'pending' | 'approved' | 'rejected'; decidedAt?: string };
export type Task = {
  id: string; title: string; description: string; sphere: string; directionId?: string; subcategory: string;
  dueDate: string | null; dueTime?: string | null; durationMinutes?: number; waitingFor?: string;
  queue: number; priority: Priority; focus: boolean; status: Status; demo: boolean; revision: number;
  createdAt: string; updatedAt: string; events: TaskEvent[]; result?: string; proposal?: Proposal;
};
export type Operation =
  | { op: 'complete' }
  | { op: 'focus'; value: boolean }
  | { op: 'defer'; value: boolean; waitingFor?: string }
  | { op: 'edit'; description: string; sphere: string; directionId: string | null; dueDate: string | null; dueTime: string | null; durationMinutes: number; waitingFor: string; queue: number; priority: Priority }
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
export function event(title: string, detail: string, actor = 'Система'): TaskEvent { return { id: crypto.randomUUID(), at: new Date().toISOString(), title, detail, actor }; }
export function hydrateTask(task: Task): Task {
  const status = Object.hasOwn(statuses, task.status) ? task.status : 'pending';
  return { ...task, directionId: task.directionId || legacyDirectionId(task.sphere, task.subcategory), dueTime: task.dueTime ?? null,
    durationMinutes: validDuration(task.durationMinutes) ? task.durationMinutes : 60, waitingFor: typeof task.waitingFor === 'string' ? task.waitingFor : '',
    focus: Boolean(task.focus), status };
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
    waitingFor, queue: input.queue, priority: input.priority, focus: false, demo: false, status: waitingFor ? 'someday' : 'pending', revision: 1,
    createdAt: now, updatedAt: now, events: [event('Задача добавлена', waitingFor ? `Отложена до ситуации: ${waitingFor}` : 'Сохранена в вашем пространстве.', 'Вы')] };
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
    next.waitingFor = operation.value ? waitingFor : ''; next.status = operation.value ? 'someday' : 'pending';
    next.events.push(event(operation.value ? 'Перенесена во временное хранилище' : 'Возвращена в план', operation.value ? `До ситуации: ${waitingFor}` : 'Задача снова активна.', 'Вы'));
  } else if (operation.op === 'edit') {
    next.description = operation.description; next.title = operation.description.split('\n')[0].slice(0, 110); next.sphere = operation.sphere;
    next.directionId = operation.directionId ?? undefined; next.subcategory = ''; next.dueDate = operation.dueDate; next.dueTime = operation.dueTime;
    next.durationMinutes = operation.durationMinutes; next.waitingFor = operation.waitingFor.trim(); next.queue = operation.queue; next.priority = operation.priority;
    if (next.status === 'someday' && !next.waitingFor) next.status = 'pending';
    next.events.push(event('Задача отредактирована', 'Изменены свойства задачи.', 'Вы'));
  } else throw new TaskError('Подтверждения агентов ещё не подключены.', 409);
  next.revision += 1; next.updatedAt = new Date().toISOString(); return next;
}
export function parseBackup(value: unknown): Task[] {
  if (!isRecord(value) || !Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length > 500) throw new TaskError('Выберите резервную копию Orbit с задачами.');
  const ids = new Set<string>();
  return value.tasks.map((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || ids.has(candidate.id) || typeof candidate.title !== 'string' || typeof candidate.description !== 'string' || !candidate.description.trim() || typeof candidate.sphere !== 'string' || typeof candidate.subcategory !== 'string' || !validDate(candidate.dueDate) || !Number.isInteger(candidate.queue) || !priorities.includes(candidate.priority as Priority) || !Object.hasOwn(statuses, String(candidate.status)) || !isIsoDate(candidate.createdAt) || !isIsoDate(candidate.updatedAt) || !Array.isArray(candidate.events)) throw new TaskError(`Задача ${index + 1} не прошла проверку.`);
    ids.add(candidate.id); return hydrateTask({ ...candidate, demo: false } as Task);
  });
}
