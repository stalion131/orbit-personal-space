import { priorities, spheres, createTask, TaskError, type Priority, type SphereId } from '@/lib/tasks';
import { insertTask, listTasks } from '@/lib/repository';
import { insertCloudTask, listCloudTasks } from '@/lib/supabase-repository';
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
    const sphere = spheres.find(item => item.id === data.sphere); if (!sphere) throw new TaskError('Выберите сферу из списка.');
    if (typeof data.subcategory !== 'string' || data.subcategory.length > 100 || (data.subcategory && !sphere.subcategories.includes(data.subcategory as never))) throw new TaskError('Выберите подкатегорию из списка.');
    if (data.dueDate !== null && (typeof data.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate))) throw new TaskError('Укажите корректный срок.');
    if (!Number.isInteger(data.queue) || Number(data.queue) < 1 || Number(data.queue) > 999) throw new TaskError('Очередность должна быть от 1 до 999.');
    if (!priorities.includes(data.priority as Priority)) throw new TaskError('Выберите приоритет из списка.');
    const next = createTask(data.id, data.description.trim(), data.sphere as SphereId, data.subcategory, data.dueDate as string|null, Number(data.queue), data.priority as Priority);
    const task = access.mode === 'supabase' ? await insertCloudTask(access.client, access.userId, next) : await insertTask(next);
    return json({task}, 201);
  } catch (error) { return failure(error); }
}
