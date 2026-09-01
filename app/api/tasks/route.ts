import { priorities, createTask, TaskError, validDuration, validTime, type Priority } from '@/lib/tasks';
import { insertTask, listTasks } from '@/lib/repository';
import { insertCloudTask, listCloudTasks } from '@/lib/supabase-repository';
import { getCloudCatalog, getLocalCatalog } from '@/lib/catalog-repository';
import { authorize, body, json, failure } from '@/lib/http';
export async function GET(request: Request) {
  try {
    const access = await authorize(request);
    const tasks = access.mode === 'supabase' ? await listCloudTasks(access.client) : await listTasks(false);
    return json({ tasks, mode: access.mode });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const access = await authorize(request); const data = await body(request);
    if (typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id)) throw new TaskError('Некорректный идентификатор.');
    if (typeof data.description !== 'string' || !data.description.trim() || data.description.trim().length > 5000) throw new TaskError('Введите задачу длиной от 1 до 5000 символов.');
    const catalog = access.mode === 'supabase' ? await getCloudCatalog(access.client, access.userId) : await getLocalCatalog();
    const sphere = catalog.spheres.find(item => item.id === data.sphere); if (!sphere) throw new TaskError('Выберите сферу из списка.');
    if (data.directionId !== null && (typeof data.directionId !== 'string' || !catalog.directions.some(item => item.id === data.directionId && item.sphereId === sphere.id))) throw new TaskError('Выберите направление из этой сферы.');
    if (data.dueDate !== null && (typeof data.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate))) throw new TaskError('Укажите корректный срок.');
    if (!validTime(data.dueTime) || (data.dueTime && !data.dueDate)) throw new TaskError('Время можно указать только вместе с датой.');
    if (!validDuration(data.durationMinutes)) throw new TaskError('Продолжительность должна быть от 5 минут до 24 часов.');
    if (typeof data.waitingFor !== 'string' || data.waitingFor.trim().length > 240) throw new TaskError('Условие ожидания не должно превышать 240 символов.');
    if (!Number.isInteger(data.queue) || Number(data.queue) < 1 || Number(data.queue) > 999) throw new TaskError('Очередность должна быть от 1 до 999.');
    if (!priorities.includes(data.priority as Priority)) throw new TaskError('Выберите приоритет из списка.');
    const next = createTask({ id: data.id, description: data.description.trim(), sphere: sphere.id, directionId: data.directionId as string|null,
      dueDate: data.dueDate as string|null, dueTime: data.dueTime as string|null, durationMinutes: Number(data.durationMinutes),
      waitingFor: data.waitingFor.trim(), queue: Number(data.queue), priority: data.priority as Priority });
    const task = access.mode === 'supabase' ? await insertCloudTask(access.client, access.userId, next) : await insertTask(next);
    return json({task}, 201);
  } catch (error) { return failure(error); }
}
