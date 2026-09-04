import { authorize, body, failure, json } from '@/lib/http';
import { parsePprDraft } from '@/lib/ppr-drafts';
import { readTemplatePreview } from '@/lib/local-template-preview';
import { buildPprSectionPlan } from '@/lib/ppr-methodology';
import { requirePprProject } from '@/lib/ppr-project-access';
import { saveTask } from '@/lib/repository';
import { saveCloudTask } from '@/lib/supabase-repository';
import { event, TaskError } from '@/lib/tasks';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await authorize(request);
    const { id } = await context.params;
    const data = await body(request, 180000);
    if (data.confirmSave !== true) throw new TaskError('Подтвердите сохранение черновика и выбранных исходных фрагментов в проекте.');
    let draft;
    try { draft = parsePprDraft(data.draft); } catch { throw new TaskError('Черновик имеет неверный формат или превышает допустимый размер.'); }
    if (draft.taskId !== id) throw new TaskError('Черновик относится к другому проекту.', 409);
    const task = await requirePprProject(access, id);
    if (task.pprDrafts?.some(item => item.id === draft.id)) throw new TaskError('Эта версия уже сохранена. Обновите список версий.', 409);
    if (task.revision !== data.revision || draft.sourceRevision !== task.revision) throw new TaskError('Проект изменился после генерации. Сформируйте черновик по актуальным данным.', 409);
    if ((task.pprDrafts?.length || 0) >= 20) throw new TaskError('Достигнут лимит MVP: 20 сохранённых версий на проект.', 409);
    const section = buildPprSectionPlan(task.workProject).find(item => item.id === draft.sectionId);
    if (!section || task.workProject.baseTemplatePath !== draft.template.path) throw new TaskError('Раздел или шаблон проекта изменился.', 409);
    const preview = await readTemplatePreview(request, draft.template.path);
    if (preview.sourceHash !== draft.template.sourceHash || preview.textHash !== draft.template.textHash || draft.sources.some(source => !preview.chunks.some(chunk => chunk.id === source.id && chunk.text === source.text))) throw new TaskError('Исходные фрагменты изменились. Откройте шаблон заново.', 409);
    const version = Math.max(0, ...(task.pprDrafts || []).filter(item => item.sectionId === draft.sectionId).map(item => item.version)) + 1;
    const saved = { ...draft, template: { ...draft.template, name: preview.name }, sectionTitle: section.title, version, createdAt: new Date().toISOString() };
    const next = { ...task, pprDrafts: [...(task.pprDrafts || []), saved], revision: task.revision + 1, updatedAt: saved.createdAt,
      events: [...task.events, event('Сохранён черновик ППР', `${section.title} · версия ${version} · требуется инженерная проверка`, 'Вы')] };
    if (Buffer.byteLength(JSON.stringify(next.pprDrafts), 'utf8') > 500000) throw new TaskError('Достигнут лимит объёма версий этого проекта (500 КБ). Скачайте черновик; расширение хранилища потребует следующего этапа.', 409);
    if (access.mode === 'supabase') await saveCloudTask(access.client, next, task.revision);
    else await saveTask(next, task.revision);
    return json({ task: next }, 201);
  } catch (error) { return failure(error); }
}
