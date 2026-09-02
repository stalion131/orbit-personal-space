import { priorities, transition, TaskError, validDuration, validTime, type Operation, type Priority } from '@/lib/tasks';
import { getTask, saveTask, deleteTask } from '@/lib/repository';
import { getCloudTask, saveCloudTask, deleteCloudTask } from '@/lib/supabase-repository';
import { getCloudCatalog, getLocalCatalog } from '@/lib/catalog-repository';
import { authorize, body, json, failure } from '@/lib/http';
export async function PATCH(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const access = await authorize(request); const {id} = await context.params; const data = await body(request);
    const task = access.mode === 'supabase' ? await getCloudTask(access.client, id) : await getTask(id);
    if (!task) throw new TaskError('Задача не найдена.', 404);
    if (!Number.isSafeInteger(data.revision) || data.revision !== task.revision) throw new TaskError('Задача изменилась. Обновите данные и повторите действие.', 409);
    if (!['decision', 'complete', 'focus', 'defer', 'edit', 'apply_agent_triage'].includes(String(data.op))) throw new TaskError('Неизвестное действие.');
    if (data.op === 'decision' && (!['approved', 'rejected'].includes(String(data.decision)) || typeof data.proposalId !== 'string')) throw new TaskError('Некорректное решение.');
    if (data.op === 'focus' && typeof data.value !== 'boolean') throw new TaskError('Некорректная отметка первой задачи.');
    if (data.op === 'defer' && (typeof data.value !== 'boolean' || (data.value && (typeof data.waitingFor !== 'string' || !data.waitingFor.trim() || data.waitingFor.trim().length > 240)))) throw new TaskError('Укажите ситуацию, до которой отложить задачу.');
    if (data.op === 'edit') {
      if (typeof data.description !== 'string' || !data.description.trim() || data.description.trim().length > 5000 || typeof data.sphere !== 'string' || !Number.isInteger(data.queue) || Number(data.queue) < 1 || Number(data.queue) > 999 || !priorities.includes(data.priority as Priority) || (data.dueDate !== null && (typeof data.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate))) || !validTime(data.dueTime) || (data.dueTime && !data.dueDate) || !validDuration(data.durationMinutes) || typeof data.waitingFor !== 'string' || data.waitingFor.trim().length > 240) throw new TaskError('Проверьте поля задачи.');
      const catalog = access.mode === 'supabase' ? await getCloudCatalog(access.client, access.userId) : await getLocalCatalog();
      if (!catalog.spheres.some(item => item.id === data.sphere) || (data.directionId !== null && (typeof data.directionId !== 'string' || !catalog.directions.some(item => item.id === data.directionId && item.sphereId === data.sphere)))) throw new TaskError('Выберите сферу и направление из каталога.');
    }
    if (data.op === 'apply_agent_triage' && (typeof data.proposalId !== 'string' || typeof data.nextAction !== 'string' || !data.nextAction.trim() || data.nextAction.length > 500 || typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 500 || (data.dueDate !== null && (typeof data.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate))) || !validDuration(data.durationMinutes) || !priorities.includes(data.priority as Priority) || typeof data.focus !== 'boolean')) throw new TaskError('Предложение агента имеет неверный формат.');
    const next = transition(task, data as unknown as Operation);
    if (access.mode === 'supabase') await saveCloudTask(access.client, next, task.revision);
    else await saveTask(next, task.revision);
    return json({task: next});
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const access = await authorize(request); const { id } = await context.params; const data = await body(request);
    if (!Number.isSafeInteger(data.revision)) throw new TaskError('Задача изменилась. Обновите страницу.', 409);
    const revision = Number(data.revision);
    if (access.mode === 'supabase') await deleteCloudTask(access.client, id, revision); else await deleteTask(id, revision);
    return json({ deleted: true });
  } catch (error) { return failure(error); }
}
