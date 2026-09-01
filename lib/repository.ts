import { spheres, TaskError, type Task } from './tasks';

// Supabase is the only persistent store in Vercel. This small in-memory mode
// keeps local UI development possible when no .env.local is configured.
const localTasks = new Map<string, Task>();
const clone = (task: Task) => JSON.parse(JSON.stringify(task)) as Task;

export async function listTasks(demo: boolean): Promise<Task[]> {
  return [...localTasks.values()]
    .filter(task => task.demo === demo && spheres.some(sphere => sphere.id === task.sphere))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .map(clone);
}
export async function getTask(id: string): Promise<Task | null> {
  const task = localTasks.get(id);
  return task ? clone(task) : null;
}
export async function insertTask(task: Task): Promise<Task> {
  const saved = localTasks.get(task.id);
  if (saved && (saved.description !== task.description || saved.sphere !== task.sphere || saved.demo !== task.demo)) throw new TaskError('Идентификатор уже используется другой задачей.', 409);
  localTasks.set(task.id, clone(task));
  return clone(localTasks.get(task.id)!);
}
export async function saveTask(task: Task, expectedRevision: number): Promise<void> {
  const saved = localTasks.get(task.id);
  if (!saved || saved.revision !== expectedRevision) throw new TaskError('Задача изменилась в другой вкладке. Обновите её перед действием.', 409);
  localTasks.set(task.id, clone(task));
}
