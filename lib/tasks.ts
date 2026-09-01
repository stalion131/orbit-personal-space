export const statuses = { pending: 'Ожидает', running: 'В работе', approval: 'Ждёт решения', completed: 'Завершена', error: 'Ошибка' } as const;
export type Status = keyof typeof statuses;
export const spheres = [
  { id: 'work', name: 'Работа', color: '#fc4c02', subcategories: ['Лаборатория Комнатного', 'Сфера строительства', 'Сфера строительства / Текущие проекты'] },
  { id: 'personal', name: 'Личные задачи', color: '#a78bfa', subcategories: ['Квартира'] },
  { id: 'travel', name: 'Путешествия', color: '#38bdf8', subcategories: ['Поиск и бронирование билетов', 'Составление маршрутов', 'Покупка и бронирование билетов'] },
  { id: 'fitness', name: 'Тренировки и питание', color: '#22c55e', subcategories: [] },
  { id: 'learning', name: 'Обучение и развитие', color: '#818cf8', subcategories: [] },
  { id: 'shopping', name: 'Покупки', color: '#f59e0b', subcategories: [] },
  { id: 'meetings', name: 'Встречи', color: '#f43f5e', subcategories: [] },
] as const;
export type SphereId = (typeof spheres)[number]['id'];
export const priorities = ['low', 'medium', 'high', 'critical'] as const;
export type Priority = (typeof priorities)[number];
export type TaskEvent = { id: string; at: string; title: string; detail: string; actor: string };
export type Proposal = { id: string; title: string; body: string; recipient: string; cost: string; state: 'pending' | 'approved' | 'rejected'; decidedAt?: string };
export type Task = { id: string; title: string; description: string; sphere: SphereId; subcategory: string; dueDate: string | null; queue: number; priority: Priority; status: Status; demo: boolean; revision: number; createdAt: string; updatedAt: string; events: TaskEvent[]; result?: string; proposal?: Proposal };
export type Operation = { op: 'simulate' | 'complete' } | { op: 'decision'; proposalId: string; decision: 'approved' | 'rejected' };
export class TaskError extends Error { constructor(message: string, public status = 400) { super(message); } }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function isIsoDate(value: unknown) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
export function parseBackup(value: unknown): Task[] {
  if (!isRecord(value) || value.format !== 'orbit-tasks-v1' || !Array.isArray(value.tasks)) throw new TaskError('Выберите резервную копию Orbit формата orbit-tasks-v1.');
  if (!value.tasks.length || value.tasks.length > 500) throw new TaskError('Резервная копия должна содержать от 1 до 500 задач.');
  const ids = new Set<string>();
  return value.tasks.map((candidate, index) => {
    if (!isRecord(candidate)) throw new TaskError(`Задача ${index + 1} имеет неверный формат.`);
    const sphere = spheres.find(item => item.id === candidate.sphere);
    const valid =
      typeof candidate.id === 'string' && candidate.id.length >= 1 && candidate.id.length <= 120 &&
      typeof candidate.title === 'string' && candidate.title.length >= 1 && candidate.title.length <= 110 &&
      typeof candidate.description === 'string' && candidate.description.length >= 1 && candidate.description.length <= 5000 &&
      !!sphere && typeof candidate.subcategory === 'string' && candidate.subcategory.length <= 100 &&
      (candidate.subcategory === '' || sphere.subcategories.includes(candidate.subcategory as never)) &&
      (candidate.dueDate === null || (typeof candidate.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.dueDate))) &&
      Number.isInteger(candidate.queue) && Number(candidate.queue) >= 1 && Number(candidate.queue) <= 999 &&
      priorities.includes(candidate.priority as Priority) && Object.hasOwn(statuses, String(candidate.status)) &&
      Number.isSafeInteger(candidate.revision) && Number(candidate.revision) > 0 &&
      isIsoDate(candidate.createdAt) && isIsoDate(candidate.updatedAt) && Array.isArray(candidate.events) && candidate.events.length <= 1000;
    if (!valid) throw new TaskError(`Задача ${index + 1} не прошла проверку.`);
    if (ids.has(candidate.id as string)) throw new TaskError(`В копии повторяется идентификатор задачи ${index + 1}.`);
    ids.add(candidate.id as string);
    const serialized = JSON.stringify(candidate);
    if (serialized.length > 65536) throw new TaskError(`Задача ${index + 1} слишком большая.`);
    return { ...candidate, demo: false } as Task;
  });
}
export function event(title: string, detail: string, actor = 'Система'): TaskEvent { return { id: crypto.randomUUID(), at: new Date().toISOString(), title, detail, actor }; }
export function createTask(id: string, description: string, sphere: SphereId, subcategory: string, dueDate: string | null, queue: number, priority: Priority, demo = false): Task {
  const now = new Date().toISOString();
  return { id, title: description.split('\n')[0].slice(0, 110), description, sphere, subcategory, dueDate, queue, priority, demo, status: 'pending', revision: 1, createdAt: now, updatedAt: now, events: [event('Задача добавлена', demo ? 'Демонстрационный пример. Реальные инструменты не вызываются.' : 'Сохранена в вашем пространстве. Оркестратор ещё не подключён.', demo ? 'Демо' : 'Вы')] };
}
export function transition(task: Task, operation: Operation): Task {
  const next = structuredClone(task);
  if (operation.op === 'simulate') {
    if (!task.demo || !['pending', 'running', 'error'].includes(task.status) || task.proposal) throw new TaskError('Демонстрация недоступна для этой задачи.', 409);
    next.status = 'approval';
    next.events.push(event('Демонстрационный план подготовлен', 'Фиксированный пример: разбор задачи → подготовка черновика → ожидание решения. Поиск и LLM не запускались.', 'Демо-сценарий'));
    next.proposal = { id: crypto.randomUUID(), state: 'pending', title: task.sphere === 'travel' ? 'Согласовать вариант проживания' : 'Согласовать черновик запроса', recipient: 'Тестовый получатель — отправка отключена', cost: task.sphere === 'travel' ? '240 € · условный бюджет, не реальная цена' : 'Расходов нет', body: task.sphere === 'travel' ? 'Пример предложения: проживание в Лиссабоне на две ночи. Условная стоимость — 240 €. Даты, доступность и условия отмены не проверялись. Это демонстрация интерфейса, а не найденное предложение.' : `Здравствуйте!\n\nПрошу уточнить условия по следующему запросу:\n${task.description}\n\nСпасибо!\n\nЭто демонстрационный черновик. Адрес получателя не задан, письмо не будет отправлено.` };
    next.events.push(event('Требуется ваше решение', 'Проверьте полный текст предложения. Одобрение сохранит только решение.', 'Демо-сценарий'));
    delete next.result;
  } else if (operation.op === 'decision') {
    if (!task.demo || task.status !== 'approval' || !task.proposal || task.proposal.id !== operation.proposalId || task.proposal.state !== 'pending') throw new TaskError('Предложение уже обработано или изменилось. Обновите задачу.', 409);
    next.proposal = { ...task.proposal, state: operation.decision, decidedAt: new Date().toISOString() };
    next.status = 'pending';
    next.result = operation.decision === 'approved' ? 'Вы одобрили предложение. Исполнение отключено: ничего не отправлено, не забронировано и не оплачено.' : 'Вы отклонили предложение. Никаких внешних действий не выполнено.';
    next.events.push(event(operation.decision === 'approved' ? 'Предложение одобрено' : 'Предложение отклонено', next.result, 'Вы'));
  } else if (operation.op === 'complete') {
    if (task.status !== 'pending' || task.proposal?.state === 'pending') throw new TaskError('Сначала обработайте ожидающее решение.', 409);
    next.status = 'completed';
    next.result = 'Вы вручную отметили задачу завершённой. Система не выполняла внешних действий.';
    next.events.push(event('Задача завершена вручную', next.result, 'Вы'));
  } else { throw new TaskError('Неизвестное действие.'); }
  next.revision += 1;
  next.updatedAt = new Date().toISOString();
  return next;
}
export function demoTasks(): Task[] {
  const examples: [string, SphereId, string, Status, Priority, number][] = [
    ['Спланировать выходные в Лиссабоне', 'travel', 'Составление маршрутов', 'approval', 'high', 1],
    ['Подобрать материалы по AI-агентам', 'learning', '', 'running', 'medium', 2],
    ['Подготовить презентацию для Лаборатории Комнатного', 'work', 'Лаборатория Комнатного', 'approval', 'critical', 1],
    ['Составить программу силовых тренировок', 'fitness', '', 'pending', 'medium', 3],
    ['Купить расходные материалы', 'shopping', '', 'completed', 'low', 4],
    ['Запланировать семейный ужин', 'personal', '', 'error', 'high', 2],
  ];
  return examples.map(([description, sphere, subcategory, status, priority, queue], i) => {
    const due = new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10);
    let task = createTask(`balance-demo-${i + 1}`, description, sphere, subcategory, due, queue, priority, true);
    if (status === 'approval') task = transition(task, { op: 'simulate' });
    else if (status === 'completed') task = transition(task, { op: 'complete' });
    else {
      task.status = status;
      if (status === 'running') task.events.push(event('Пример статуса «В работе»', 'Реальный процесс не запущен. Используйте «Продолжить демо», чтобы проверить следующий шаг.', 'Демо'));
      if (status === 'error') { task.result = 'Демонстрация ошибки: почтовая интеграция не подключена.'; task.events.push(event('Пример ошибки интеграции', task.result, 'Демо')); }
    }
    return task;
  });
}
