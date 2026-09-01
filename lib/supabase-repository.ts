import type { SupabaseClient } from '@supabase/supabase-js';
import { TaskError, type Task } from './tasks';

type TaskRow = { payload: Task };

function databaseError(message: string, code?: string) {
  if (code === '23505') return new TaskError('Такая задача уже существует.', 409);
  return new TaskError(message, 502);
}

export async function listCloudTasks(client: SupabaseClient): Promise<Task[]> {
  const { data, error } = await client.from('orbit_tasks').select('payload').order('updated_at', { ascending: false }).order('id');
  if (error) throw databaseError('Не удалось получить задачи из Supabase.', error.code);
  return ((data ?? []) as TaskRow[]).map(row => row.payload);
}

export async function getCloudTask(client: SupabaseClient, id: string): Promise<Task | null> {
  const { data, error } = await client.from('orbit_tasks').select('payload').eq('id', id).maybeSingle();
  if (error) throw databaseError('Не удалось получить задачу из Supabase.', error.code);
  return (data as TaskRow | null)?.payload ?? null;
}

export async function insertCloudTask(client: SupabaseClient, ownerId: string, task: Task): Promise<Task> {
  const { data, error } = await client
    .from('orbit_tasks')
    .insert({ id: task.id, owner_id: ownerId, payload: task, revision: task.revision, updated_at: task.updatedAt })
    .select('payload')
    .single();
  if (error) throw databaseError('Не удалось сохранить задачу в Supabase.', error.code);
  return (data as TaskRow).payload;
}

export async function saveCloudTask(client: SupabaseClient, task: Task, expectedRevision: number): Promise<void> {
  const { data, error } = await client
    .from('orbit_tasks')
    .update({ payload: task, revision: task.revision, updated_at: task.updatedAt })
    .eq('id', task.id)
    .eq('revision', expectedRevision)
    .select('id');
  if (error) throw databaseError('Не удалось обновить задачу в Supabase.', error.code);
  if (!data?.length) throw new TaskError('Задача изменилась в другой вкладке. Обновите её перед действием.', 409);
}

export async function importCloudTasks(client: SupabaseClient, ownerId: string, tasks: Task[]): Promise<void> {
  const rows = tasks.map(task => ({ id: task.id, owner_id: ownerId, payload: task, revision: task.revision, updated_at: task.updatedAt }));
  const { error } = await client.from('orbit_tasks').upsert(rows, { onConflict: 'id' });
  if (error) throw databaseError('Не удалось перенести резервную копию в Supabase.', error.code);
}
