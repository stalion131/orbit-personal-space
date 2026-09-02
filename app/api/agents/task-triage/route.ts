import { getCloudCatalog, getLocalCatalog } from '@/lib/catalog-repository';
import { authorize, body, failure, json } from '@/lib/http';
import { listTasks } from '@/lib/repository';
import { listCloudTasks } from '@/lib/supabase-repository';
import { triageTasks } from '@/lib/task-triage-agent';
import { TaskError } from '@/lib/tasks';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const access = await authorize(request);
    const data = await body(request, 1024);
    if (data.confirmDataTransfer !== true) throw new TaskError('Подтвердите передачу задач в OpenAI для анализа.', 400);
    if (!process.env.OPENAI_API_KEY?.trim()) throw new TaskError('ИИ-агент ещё не настроен: добавьте OPENAI_API_KEY в Vercel.', 503);
    const [allTasks, catalog] = await Promise.all([
      access.mode === 'supabase' ? listCloudTasks(access.client) : listTasks(false),
      access.mode === 'supabase' ? getCloudCatalog(access.client, access.userId) : getLocalCatalog(),
    ]);
    const tasks = allTasks.filter(task => task.status !== 'completed');
    if (!tasks.length) throw new TaskError('Нет активных задач для разбора.', 409);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return json({ result: await triageTasks(tasks, catalog, today) });
  } catch (error) {
    return failure(error);
  }
}
