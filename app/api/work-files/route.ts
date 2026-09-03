import { readdir, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { authorize, failure, json } from '@/lib/http';
import { browserPath, containedRealPath, localFilesRoot } from '@/lib/local-files';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await authorize(request);
    const root = await localFilesRoot(request);
    if (!root) return json({ enabled: false, items: [] });
    const url = new URL(request.url);
    const relative = url.searchParams.get('path') || '';
    if (relative.length > 1000) return json({ error: 'Слишком длинный путь.' }, 400);
    const directory = await containedRealPath(root, relative);
    const entries = await readdir(directory, { withFileTypes: true });
    const visible = entries.filter(entry => !entry.name.startsWith('~$') && !entry.name.startsWith('.')).slice(0, 500);
    const items = await Promise.all(visible.map(async entry => {
      const target = await containedRealPath(root, browserPath(root, directory) ? `${browserPath(root, directory)}/${entry.name}` : entry.name);
      const info = await stat(target);
      return { name: entry.name, path: browserPath(root, target), kind: entry.isDirectory() ? 'directory' : 'file', extension: entry.isFile() ? entry.name.split('.').pop()?.toLocaleLowerCase() || '' : '', size: entry.isFile() ? info.size : null, modifiedAt: info.mtime.toISOString() };
    }));
    items.sort((a, b) => Number(a.kind === 'file') - Number(b.kind === 'file') || a.name.localeCompare(b.name, 'ru'));
    return json({ enabled: true, rootName: basename(root), path: browserPath(root, directory), items });
  } catch (error) { return failure(error); }
}
