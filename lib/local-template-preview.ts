import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { containedRealPath, localFilesRoot } from './local-files';
import { loadIndex } from './local-template-index';
import { splitTemplateText, type TemplatePreview } from './ppr-drafts';
import { TaskError } from './tasks';

export async function readTemplatePreview(request: Request, path: string): Promise<TemplatePreview> {
  const root = await localFilesRoot(request);
  if (!root) throw new TaskError('Выбор фрагментов и генерация по локальным шаблонам доступны только на этом компьютере.', 409);
  if (!path || path.length > 1000) throw new TaskError('Выберите шаблон из библиотеки.');
  const sourcePath = await containedRealPath(root, path);
  const index = await loadIndex(true);
  const document = index?.documents.find(item => item.path === path && ['.docx', '.pdf'].includes(item.extension.toLowerCase()));
  if (!document || !document.content.trim() || !document.sha256 || !/^[a-f0-9]{64}$/.test(document.sha256)) throw new TaskError('Шаблон не распознан. Обновите локальный индекс.', 409);
  const info = await stat(/*turbopackIgnore: true*/ sourcePath);
  if (!info.isFile() || info.size > 25000000) throw new TaskError('Шаблон должен быть файлом размером до 25 МБ.', 413);
  const sourceHash = createHash('sha256').update(await readFile(/*turbopackIgnore: true*/ sourcePath)).digest('hex');
  if (sourceHash !== document.sha256) throw new TaskError('Исходный файл изменился после индексации. Обновите индекс и откройте шаблон заново.', 409);
  const chunks = splitTemplateText(document.content);
  if (chunks.length > 1500) throw new TaskError('В шаблоне слишком много фрагментов для текущего MVP. Выберите отдельный раздел.', 413);
  return { path: document.path, name: document.name, sourceHash, textHash: createHash('sha256').update(document.content).digest('hex'), chunks };
}
