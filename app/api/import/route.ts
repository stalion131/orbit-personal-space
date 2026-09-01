import { authorize, body, failure, json } from '@/lib/http';
import { insertTask } from '@/lib/repository';
import { importCloudTasks } from '@/lib/supabase-repository';
import { parseBackup } from '@/lib/tasks';

export async function POST(request: Request) {
  try {
    const access = await authorize(request);
    const data = await body(request, 2_000_000);
    const tasks = parseBackup(data);
    if (access.mode === 'supabase') await importCloudTasks(access.client, access.userId, tasks);
    else for (const task of tasks) await insertTask(task);
    return json({ imported: tasks.length });
  } catch (error) {
    return failure(error);
  }
}
