import { authorize, body, failure, json } from '@/lib/http';
import { getCloudCatalog, getLocalCatalog } from '@/lib/catalog-repository';
import { getTask, saveTask } from '@/lib/repository';
import { getCloudTask, saveCloudTask } from '@/lib/supabase-repository';
import {
  briefIssues,
  briefSnapshot,
  briefWarnings,
  isBriefApproved,
} from '@/lib/work-brief';
import { event, TaskError, type Task } from '@/lib/tasks';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const access = await authorize(request);
    const { id } = await context.params;
    const data = await body(request, 4096);
    if (data.confirm !== true)
      throw new TaskError('Подтвердите действие с ТЗ.');
    const [task, catalog] = await Promise.all([
      access.mode === 'supabase'
        ? getCloudTask(access.client, id)
        : getTask(id),
      access.mode === 'supabase'
        ? getCloudCatalog(access.client, access.userId)
        : getLocalCatalog(),
    ]);
    if (!task) throw new TaskError('Проект не найден.', 404);
    const direction = catalog.directions.find(
      (item) =>
        item.sphereId === 'work' && item.name.trim().toLowerCase() === 'ппр',
    );
    if (
      !task.workProject ||
      task.sphere !== 'work' ||
      task.directionId !== direction?.id
    )
      throw new TaskError('Нужен сохранённый проект направления ППР.', 409);
    if (data.revision !== task.revision)
      throw new TaskError(
        'Проект изменился. Обновите его перед действием.',
        409,
      );
    const project = task.workProject;
    const at = new Date().toISOString();
    let next: Task;
    if (data.op === 'approve') {
      const issues = briefIssues(project);
      if (issues.length) throw new TaskError(issues.join(' '), 409);
      if (
        briefWarnings(project).length &&
        data.acknowledgeOpenQuestions !== true
      )
        throw new TaskError(
          'Подтвердите, что ознакомились с открытыми вопросами.',
        );
      if (isBriefApproved(task, project))
        throw new TaskError('Это ТЗ уже утверждено.', 409);
      if ((task.briefApprovals?.length || 0) >= 10)
        throw new TaskError(
          'Достигнут лимит 10 редакций ТЗ. Экспортируйте проект перед расширением архива.',
          409,
        );
      const approval = {
        id: crypto.randomUUID(),
        version: (task.briefApprovals?.length || 0) + 1,
        at,
        snapshot: briefSnapshot(project),
      };
      next = {
        ...task,
        briefApprovals: [...(task.briefApprovals || []), approval],
        events: [
          ...task.events,
          event(
            'ТЗ утверждено для разработки',
            `Редакция ${approval.version}. Открытые вопросы: ${briefWarnings(project).length}. Не является разрешением на производство работ.`,
            'Вы',
          ),
        ],
      };
    } else if (data.op === 'prepare_tk') {
      if (
        !isBriefApproved(task, project) ||
        project.documentType !== 'ppr' ||
        project.developmentMode !== 'with_tk'
      )
        throw new TaskError('Нужно актуальное утверждённое ТЗ ППР с ТК.', 409);
      const approval = task.briefApprovals!.at(-1)!;
      if (task.tkAssignments?.some((item) => item.briefId === approval.id))
        throw new TaskError('Задания этой редакции уже подготовлены.', 409);
      const assignments = approval.snapshot.brief.tkList.map((title) => ({
        id: crypto.randomUUID(),
        title,
        briefId: approval.id,
        briefVersion: approval.version,
        createdAt: at,
        status: 'prepared' as const,
        executor: 'tk_developer' as const,
      }));
      next = {
        ...task,
        tkAssignments: [...(task.tkAssignments || []), ...assignments],
        events: [
          ...task.events,
          event(
            'Задания на ТК подготовлены',
            `${assignments.length} карт по ТЗ ${approval.version}. Исполнитель ТК пока не подключён.`,
            'Вы',
          ),
        ],
      };
    } else throw new TaskError('Неизвестная операция ТЗ.');
    next = { ...next, revision: task.revision + 1, updatedAt: at };
    if (Buffer.byteLength(JSON.stringify(next.briefApprovals), 'utf8') > 500000)
      throw new TaskError('Архив ТЗ превышает лимит 500 КБ.', 409);
    if (access.mode === 'supabase')
      await saveCloudTask(access.client, next, task.revision);
    else await saveTask(next, task.revision);
    return json({ task: next });
  } catch (error) {
    return failure(error);
  }
}
