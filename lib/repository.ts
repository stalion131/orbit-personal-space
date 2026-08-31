import { env } from 'cloudflare:workers';
import { spheres, TaskError, type Task } from './tasks';
let ready: Promise<D1Database> | undefined;
export function database() {
  if (!env.DB) throw new Error('Database unavailable');
  ready ??= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS tasks (id text PRIMARY KEY NOT NULL, payload text NOT NULL, revision integer NOT NULL, demo integer DEFAULT 0 NOT NULL, updated_at text NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_demo_updated ON tasks (demo, updated_at)'),
  ]).then(async () => { await env.DB.prepare('PRAGMA optimize').run(); return env.DB; });
  return ready;
}
export async function listTasks(demo: boolean): Promise<Task[]> {
  const result = await (await database()).prepare('SELECT payload FROM tasks WHERE demo = ? ORDER BY updated_at DESC, id ASC').bind(demo ? 1 : 0).all<{payload: string}>();
  return result.results.map(row => JSON.parse(row.payload) as Task).filter(task => spheres.some(sphere => sphere.id === task.sphere));
}
export async function getTask(id: string): Promise<Task | null> {
  const row = await (await database()).prepare('SELECT payload FROM tasks WHERE id = ?').bind(id).first<{payload: string}>();
  return row ? JSON.parse(row.payload) as Task : null;
}
export async function insertTask(task: Task): Promise<Task> {
  await (await database()).prepare('INSERT OR IGNORE INTO tasks (id, payload, revision, demo, updated_at) VALUES (?, ?, ?, ?, ?)').bind(task.id, JSON.stringify(task), task.revision, task.demo ? 1 : 0, task.updatedAt).run();
  const saved = await getTask(task.id);
  if (!saved || saved.description !== task.description || saved.sphere !== task.sphere || saved.demo !== task.demo) throw new TaskError('Идентификатор уже используется другой задачей.', 409);
  return saved;
}
export async function saveTask(task: Task, expectedRevision: number): Promise<void> {
  const result = await (await database()).prepare('UPDATE tasks SET payload = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?').bind(JSON.stringify(task), task.revision, task.updatedAt, task.id, expectedRevision).run();
  if (result.meta.changes !== 1) throw new TaskError('Задача изменилась в другой вкладке. Обновите её перед действием.', 409);
}
