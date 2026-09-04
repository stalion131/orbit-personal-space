import type { Access } from './http';
import { getCloudCatalog, getLocalCatalog } from './catalog-repository';
import { getTask } from './repository';
import { getCloudTask } from './supabase-repository';
import { TaskError, type Task, type WorkProject } from './tasks';

export async function requirePprProject(access: Access, id: string): Promise<Task & { workProject: WorkProject }> {
  const [task, catalog] = await Promise.all([
    access.mode === 'supabase' ? getCloudTask(access.client, id) : getTask(id),
    access.mode === 'supabase' ? getCloudCatalog(access.client, access.userId) : getLocalCatalog(),
  ]);
  if (!task) throw new TaskError('Проект не найден.', 404);
  const direction = catalog.directions.find(item => item.sphereId === 'work' && item.name.trim().toLocaleLowerCase('ru') === 'ппр');
  if (task.sphere !== 'work' || !direction || task.directionId !== direction.id || task.workProject?.documentType !== 'ppr') throw new TaskError('Нужен сохранённый проект ППР из направления «ППР».', 409);
  return task as Task & { workProject: WorkProject };
}
