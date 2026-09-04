import { authorize, body, failure, json } from '@/lib/http';
import { readTemplatePreview } from '@/lib/local-template-preview';
import { draftableSectionIds, MAX_SOURCE_CHARACTERS, validDraftId, type DraftableSectionId } from '@/lib/ppr-drafts';
import { draftPprSection } from '@/lib/ppr-developer-agent';
import { evaluatePprReadiness } from '@/lib/ppr-methodology';
import { requirePprProject } from '@/lib/ppr-project-access';
import { TaskError } from '@/lib/tasks';
import { isBriefApproved } from '@/lib/work-brief';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const access = await authorize(request);
    const data = await body(request, 8192);
    if (data.confirmDataTransfer !== true) throw new TaskError('Подтвердите передачу выбранных фрагментов и паспорта проекта в OpenAI.', 400);
    if (!validDraftId(data.taskId) || !Number.isSafeInteger(data.revision) || !draftableSectionIds.includes(data.sectionId as DraftableSectionId) || typeof data.templatePath !== 'string' || typeof data.textHash !== 'string' || typeof data.sourceHash !== 'string') throw new TaskError('Проверьте проект, раздел и выбранный шаблон.');
    if (!Array.isArray(data.chunkIds) || !data.chunkIds.length || data.chunkIds.length > 8 || data.chunkIds.some(id => typeof id !== 'string') || new Set(data.chunkIds).size !== data.chunkIds.length) throw new TaskError('Выберите от 1 до 8 разных фрагментов.');
    const task = await requirePprProject(access, data.taskId);
    if (task.revision !== data.revision) throw new TaskError('Проект изменился. Сохраните паспорт и подтвердите отправку заново.', 409);
    if (!isBriefApproved(task, task.workProject)) throw new TaskError('Сначала утвердите актуальную редакцию ТЗ.', 409);
    if (!evaluatePprReadiness(task.workProject).ready) throw new TaskError('Перед генерацией заполните объект, вид работ и режим ППР.', 409);
    if (task.workProject.baseTemplatePath !== data.templatePath) throw new TaskError('Сначала сохраните выбранный шаблон в паспорте проекта.', 409);
    const preview = await readTemplatePreview(request, data.templatePath);
    if (preview.sourceHash !== data.sourceHash || preview.textHash !== data.textHash) throw new TaskError('Шаблон или его текст изменился. Откройте фрагменты заново и подтвердите отправку.', 409);
    const sources = preview.chunks.filter(item => (data.chunkIds as string[]).includes(item.id));
    if (sources.length !== data.chunkIds.length || sources.reduce((sum, item) => sum + item.text.length, 0) > MAX_SOURCE_CHARACTERS) throw new TaskError('Выбранные фрагменты недоступны или превышают 12 000 символов.');
    if (!process.env.OPENAI_API_KEY?.trim()) throw new TaskError('На этом компьютере не задан серверный OPENAI_API_KEY. Ключ Vercel локальной версии недоступен.', 503);
    const { chunks: _chunks, ...template } = preview;
    return json({ draft: await draftPprSection(task, data.sectionId as DraftableSectionId, template, sources, request.signal) });
  } catch (error) { return failure(error); }
}
