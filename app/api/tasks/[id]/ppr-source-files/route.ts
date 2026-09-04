import { readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { authorize, failure, json } from '@/lib/http';
import {
  browserPath,
  containedRealPath,
  localFilesRoot,
} from '@/lib/local-files';
import { requirePprProject } from '@/lib/ppr-project-access';
import { readWorkBrief } from '@/lib/work-brief';
import { TaskError } from '@/lib/tasks';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const access = await authorize(request);
    const task = await requirePprProject(access, (await context.params).id);
    const root = await localFilesRoot(request);
    if (!root) return json({ enabled: false, items: [] });
    const folder = readWorkBrief(
      task.workProject.brief,
      task.workProject,
    ).workingFolder;
    if (!folder) return json({ enabled: true, configured: false, items: [] });
    const requested = isAbsolute(folder)
      ? relative(root, resolve(folder))
      : folder;
    const projectRoot = await containedRealPath(root, requested);
    if (!(await stat(projectRoot)).isDirectory())
      throw new TaskError('В рабочей папке укажите каталог, а не файл.');
    const subpath = new URL(request.url).searchParams.get('path') || '';
    if (subpath.length > 1000) throw new TaskError('Слишком длинный путь.');
    const directory = await containedRealPath(projectRoot, subpath);
    if (!(await stat(directory)).isDirectory())
      throw new TaskError('Папка не найдена.', 404);
    const entries = (await readdir(directory, { withFileTypes: true })).filter(
      (e) => !e.name.startsWith('.') && !e.name.startsWith('~$'),
    );
    let unavailable = 0;
    const items = (
      await Promise.all(
        entries.slice(0, 500).map(async (e) => {
          try {
            const target = await containedRealPath(
              projectRoot,
              `${browserPath(projectRoot, directory)}/${e.name}`.replace(
                /^\//,
                '',
              ),
            );
            const info = await stat(target);
            if (!info.isFile() && !info.isDirectory()) return null;
            return {
              name: e.name,
              path: browserPath(projectRoot, target),
              downloadPath: info.isFile() ? browserPath(root, target) : '',
              kind: info.isDirectory() ? 'directory' : 'file',
              size: info.isFile() ? info.size : 0,
            };
          } catch {
            unavailable++;
            return null;
          }
        }),
      )
    ).filter((item) => item !== null);
    items.sort(
      (a, b) =>
        Number(a.kind === 'file') - Number(b.kind === 'file') ||
        a.name.localeCompare(b.name, 'ru'),
    );
    return json({
      enabled: true,
      configured: true,
      folderName: basename(projectRoot),
      path: browserPath(projectRoot, directory),
      items,
      truncated: entries.length > 500,
      unavailable,
    });
  } catch (error) {
    return failure(error);
  }
}
