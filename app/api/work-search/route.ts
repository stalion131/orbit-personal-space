import { authorize, failure, json } from '@/lib/http';
import { localFilesRoot } from '@/lib/local-files';
import { loadIndex, type SearchDocument } from '@/lib/local-template-index';
import { TaskError } from '@/lib/tasks';
export const runtime = 'nodejs';

function snippet(document: SearchDocument, terms: string[]) {
  const lower = document.content.toLocaleLowerCase('ru');
  const match = terms.map(term => lower.indexOf(term)).filter(position => position >= 0).sort((a, b) => a - b)[0];
  if (match === undefined) return document.headings.find(heading => terms.some(term => heading.toLocaleLowerCase('ru').includes(term))) || document.path;
  const start = Math.max(0, match - 95);
  const end = Math.min(document.content.length, match + 185);
  return `${start ? '…' : ''}${document.content.slice(start, end).replace(/\s+/g, ' ').trim()}${end < document.content.length ? '…' : ''}`;
}

export async function GET(request: Request) {
  try {
    await authorize(request);
    if (!await localFilesRoot(request)) return json({ enabled: false, available: false, results: [] });
    const index = await loadIndex();
    if (!index) return json({ enabled: true, available: false, results: [] });

    const query = new URL(request.url).searchParams.get('q')?.trim() || '';
    if (query.length > 120) throw new TaskError('Слишком длинный поисковый запрос.', 400);
    const terms = query.toLocaleLowerCase('ru').split(/\s+/).filter(term => term.length > 1).slice(0, 8);
    if (!terms.length) return json({ enabled: true, available: true, summary: index.summary, results: [] });

    const results = index.documents.flatMap(document => {
      if (!terms.every(term => document.searchable.includes(term))) return [];
      const name = document.name.toLocaleLowerCase('ru');
      const path = document.path.toLocaleLowerCase('ru');
      const headings = document.headings.join('\n').toLocaleLowerCase('ru');
      const score = terms.reduce((total, term) => total + (name.includes(term) ? 12 : 0) + (path.includes(term) ? 6 : 0) + (headings.includes(term) ? 3 : 0) + (document.content.toLocaleLowerCase('ru').includes(term) ? 1 : 0), 0);
      return [{ path: document.path, name: document.name, extension: document.extension.replace(/^\./, ''), score, snippet: snippet(document, terms) }];
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru')).slice(0, 20);

    return json({ enabled: true, available: true, summary: index.summary, results });
  } catch (error) { return failure(error); }
}
