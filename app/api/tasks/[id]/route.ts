import { priorities, statuses, transition, TaskError, validDuration, validTime, workDocumentCategories, workDocumentStatuses, workProjectStages, type Operation, type Priority } from '@/lib/tasks';
import { getTask, saveTask, deleteTask } from '@/lib/repository';
import { getCloudTask, saveCloudTask, deleteCloudTask } from '@/lib/supabase-repository';
import { getCloudCatalog, getLocalCatalog } from '@/lib/catalog-repository';
import { authorize, body, json, failure } from '@/lib/http';
export async function PATCH(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const access = await authorize(request); const {id} = await context.params; const data = await body(request, 131072);
    const task = access.mode === 'supabase' ? await getCloudTask(access.client, id) : await getTask(id);
    if (!task) throw new TaskError('Задача не найдена.', 404);
    if (!Number.isSafeInteger(data.revision) || data.revision !== task.revision) throw new TaskError('Задача изменилась. Обновите данные и повторите действие.', 409);
    if (!['decision', 'complete', 'focus', 'defer', 'set_status', 'edit', 'add_subtask', 'edit_subtask', 'toggle_subtask', 'delete_subtask', 'edit_work_project', 'apply_agent_triage'].includes(String(data.op))) throw new TaskError('Неизвестное действие.');
    if (data.op === 'decision' && (!['approved', 'rejected'].includes(String(data.decision)) || typeof data.proposalId !== 'string')) throw new TaskError('Некорректное решение.');
    if (data.op === 'focus' && typeof data.value !== 'boolean') throw new TaskError('Некорректная отметка первой задачи.');
    if (data.op === 'defer' && (typeof data.value !== 'boolean' || (data.value && (typeof data.waitingFor !== 'string' || !data.waitingFor.trim() || data.waitingFor.trim().length > 240)))) throw new TaskError('Укажите ситуацию, до которой отложить задачу.');
    if (data.op === 'set_status' && (!Object.hasOwn(statuses, String(data.status)) || (data.status === 'someday' && (typeof data.waitingFor !== 'string' || !data.waitingFor.trim())) || (typeof data.waitingFor === 'string' && data.waitingFor.trim().length > 240))) throw new TaskError('Проверьте статус задачи.');
    if (['add_subtask', 'edit_subtask'].includes(String(data.op)) && (typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.id) || typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 300 || (data.dueDate !== null && (typeof data.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate))) || !validTime(data.dueTime) || (data.dueTime && !data.dueDate))) throw new TaskError('Проверьте название и срок этапа.');
    if (data.op === 'toggle_subtask' && (typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.id) || typeof data.value !== 'boolean')) throw new TaskError('Некорректная отметка этапа.');
    if (data.op === 'delete_subtask' && (typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.id))) throw new TaskError('Некорректный этап.');
    if (data.op === 'edit_work_project') {
      const project = data.project;
      if (!project || typeof project !== 'object' || Array.isArray(project)) throw new TaskError('Проверьте карточку рабочего проекта.');
      const record = project as Record<string, unknown>;
      const fields = [['objectName', 240], ['objectAddress', 300], ['customer', 200], ['responsible', 160]] as const;
      if (!['ppr', 'tk'].includes(String(record.documentType)) || !workProjectStages.includes(record.stage as (typeof workProjectStages)[number]) || fields.some(([field, limit]) => typeof record[field] !== 'string' || String(record[field]).trim().length > limit)) throw new TaskError('Проверьте поля карточки проекта.');
      if (!Array.isArray(record.documents) || record.documents.length > 100 || record.documents.some(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
        const document = item as Record<string, unknown>;
        return typeof document.id !== 'string' || !/^[0-9a-z-]{3,60}$/i.test(document.id) || typeof document.name !== 'string' || !document.name.trim() || document.name.trim().length > 180 || !workDocumentCategories.includes(document.category as (typeof workDocumentCategories)[number]) || typeof document.version !== 'string' || document.version.trim().length > 40 || !workDocumentStatuses.includes(document.status as (typeof workDocumentStatuses)[number]) || typeof document.updatedAt !== 'string' || Number.isNaN(Date.parse(document.updatedAt));
      })) throw new TaskError('Проверьте реестр документов.');
      if (!Array.isArray(record.checklist) || record.checklist.length > 60 || record.checklist.some(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
        const checklistItem = item as Record<string, unknown>;
        return typeof checklistItem.id !== 'string' || !/^[0-9a-z-]{3,60}$/i.test(checklistItem.id) || typeof checklistItem.title !== 'string' || !checklistItem.title.trim() || checklistItem.title.trim().length > 180 || typeof checklistItem.completed !== 'boolean';
      })) throw new TaskError('Проверьте чек-лист проекта.');
      const catalog = access.mode === 'supabase' ? await getCloudCatalog(access.client, access.userId) : await getLocalCatalog();
      const pprDirection = catalog.directions.find(item => item.sphereId === 'work' && item.name.trim().toLocaleLowerCase('ru') === 'ппр');
      if (task.sphere !== 'work' || !pprDirection || task.directionId !== pprDirection.id) throw new TaskError('Карточка доступна только для задач направления «ППР».');
    }
    if (data.op === 'edit') {
      if (typeof data.description !== 'string' || !data.description.trim() || data.description.trim().length > 5000 || typeof data.sphere !== 'string' || !Number.isInteger(data.queue) || Number(data.queue) < 1 || Number(data.queue) > 999 || !priorities.includes(data.priority as Priority) || (data.dueDate !== null && (typeof data.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate))) || !validTime(data.dueTime) || (data.dueTime && !data.dueDate) || !validDuration(data.durationMinutes) || typeof data.waitingFor !== 'string' || data.waitingFor.trim().length > 240) throw new TaskError('Проверьте поля задачи.');
      const catalog = access.mode === 'supabase' ? await getCloudCatalog(access.client, access.userId) : await getLocalCatalog();
      if (!catalog.spheres.some(item => item.id === data.sphere) || (data.directionId !== null && (typeof data.directionId !== 'string' || !catalog.directions.some(item => item.id === data.directionId && item.sphereId === data.sphere)))) throw new TaskError('Выберите сферу и направление из каталога.');
    }
    if (data.op === 'apply_agent_triage' && (typeof data.proposalId !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.proposalId) || typeof data.nextAction !== 'string' || !data.nextAction.trim() || data.nextAction.length > 300 || typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 500 || (data.dueDate !== null && (typeof data.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate))) || !validDuration(data.durationMinutes) || !priorities.includes(data.priority as Priority) || typeof data.focus !== 'boolean')) throw new TaskError('Предложение агента имеет неверный формат.');
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
