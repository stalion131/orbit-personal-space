import { transition, TaskError, type Operation } from '@/lib/tasks';
import { getTask, saveTask } from '@/lib/repository';
import { guard, body, json, failure } from '@/lib/http';
export async function PATCH(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    guard(request); const {id} = await context.params; const data = await body(request);
    const task = await getTask(id); if (!task) throw new TaskError('Задача не найдена.', 404);
    if (!Number.isSafeInteger(data.revision) || data.revision !== task.revision) throw new TaskError('Задача изменилась. Обновите данные и повторите действие.', 409);
    if (!['simulate', 'decision', 'complete'].includes(String(data.op))) throw new TaskError('Неизвестное действие.');
    if (data.op === 'decision' && (!['approved', 'rejected'].includes(String(data.decision)) || typeof data.proposalId !== 'string')) throw new TaskError('Некорректное решение.');
    const next = transition(task, data as unknown as Operation);
    await saveTask(next, task.revision); return json({task: next});
  } catch (error) { return failure(error); }
}
