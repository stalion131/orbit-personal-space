import { getCloudCatalog, getLocalCatalog } from '@/lib/catalog-repository';
import { authorize, body, failure, json } from '@/lib/http';
import { analyzePprProject } from '@/lib/ppr-developer-agent';
import { getTask } from '@/lib/repository';
import { getCloudTask } from '@/lib/supabase-repository';
import { TaskError } from '@/lib/tasks';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const access = await authorize(request);
    const data = await body(request, 2048);
    if (data.confirmDataTransfer !== true) throw new TaskError('Подтвердите передачу данных выбранного проекта в OpenAI.', 400);
    if (typeof data.taskId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.taskId)) throw new TaskError('Некорректный проект.', 400);
    if (!process.env.OPENAI_API_KEY?.trim()) throw new TaskError('Агент «Разработчик ППР» ещё не настроен: добавьте OPENAI_API_KEY.', 503);

    const [task, catalog] = await Promise.all([
      access.mode === 'supabase' ? getCloudTask(access.client, data.taskId) : getTask(data.taskId),
      access.mode === 'supabase' ? getCloudCatalog(access.client, access.userId) : getLocalCatalog(),
    ]);
    if (!task) throw new TaskError('Проект не найден.', 404);
    const pprDirection = catalog.directions.find(item => item.sphereId === 'work' && item.name.trim().toLocaleLowerCase('ru') === 'ппр');
    if (task.sphere !== 'work' || !pprDirection || task.directionId !== pprDirection.id || task.workProject?.documentType !== 'ppr') {
      throw new TaskError('Агент работает только с проектами ППР из направления «ППР».', 409);
    }
    return json({ result: await analyzePprProject(task, task.workProject) });
  } catch (error) { return failure(error); }
}
