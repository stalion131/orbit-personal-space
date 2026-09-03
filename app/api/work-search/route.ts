import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { authorize, failure, json } from '@/lib/http';
import { localFilesRoot } from '@/lib/local-files';
import { TaskError } from '@/lib/tasks';

export const runtime = 'nodejs';

type IndexEntry = {
  path: string;
  name: string;
  extension: string;
  state: 'indexed' | 'needs_conversion' | 'error';
  textFile: string | null;
  characters: number;
  headings: string[];
};

type SearchDocument = IndexEntry & { content: string; searchable: string };
type SearchIndex = {
  modifiedAt: number;
  documents: SearchDocument[];
  summary: { total: number; indexed: number; needsConversion: number; errors: number; characters: number };
};

let cachedIndex: SearchIndex | null = null;

function indexDirectory() {
  return resolve(/*turbopackIgnore: true*/ process.env.ORBIT_LOCAL_INDEX_ROOT?.trim() || resolve(process.cwd(), 'work', 'knowledge-index'));
}

async function safeIndexFile(indexRoot: string, relativeFile: string) {
  if (!relativeFile || relativeFile.includes('\0') || isAbsolute(relativeFile)) throw new TaskError('Некорректная запись локального индекса.', 503);
  const candidate = resolve(indexRoot, relativeFile);
  const candidateRelative = relative(indexRoot, candidate);
  if (candidateRelative.startsWith('..') || isAbsolute(candidateRelative)) throw new TaskError('Некорректная запись локального индекса.', 503);
  const canonical = await realpath(candidate).catch(() => '');
  if (!canonical) return null;
  const canonicalRelative = relative(indexRoot, canonical);
  if (canonicalRelative.startsWith('..') || isAbsolute(canonicalRelative)) throw new TaskError('Некорректная запись локального индекса.', 503);
  return canonical;
}

async function loadIndex() {
  const root = await realpath(/*turbopackIgnore: true*/ indexDirectory()).catch(() => '');
  if (!root) return null;
  const manifestPath = await safeIndexFile(root, 'manifest.json');
  if (!manifestPath) return null;
  const manifestInfo = await stat(/*turbopackIgnore: true*/ manifestPath);
  if (cachedIndex?.modifiedAt === manifestInfo.mtimeMs) return cachedIndex;

  const parsed = JSON.parse(await readFile(/*turbopackIgnore: true*/ manifestPath, 'utf8')) as { schema?: string; files?: unknown[] };
  if (parsed.schema !== 'orbit-local-template-index-v1' || !Array.isArray(parsed.files) || parsed.files.length > 1000) {
    throw new TaskError('Формат локального индекса не поддерживается.', 503);
  }

  const entries = parsed.files.filter((value): value is IndexEntry => {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<IndexEntry>;
    return typeof entry.path === 'string' && typeof entry.name === 'string' && typeof entry.extension === 'string'
      && ['indexed', 'needs_conversion', 'error'].includes(entry.state || '') && (entry.textFile === null || typeof entry.textFile === 'string')
      && typeof entry.characters === 'number' && Array.isArray(entry.headings) && entry.headings.every(item => typeof item === 'string');
  });

  const documents = await Promise.all(entries.filter(entry => entry.state === 'indexed' && entry.textFile).map(async entry => {
    const textPath = await safeIndexFile(root, entry.textFile!);
    const content = textPath ? await readFile(/*turbopackIgnore: true*/ textPath, 'utf8') : '';
    const searchable = `${entry.name}\n${entry.path}\n${entry.headings.join('\n')}\n${content}`.toLocaleLowerCase('ru');
    return { ...entry, content, searchable };
  }));
  cachedIndex = {
    modifiedAt: manifestInfo.mtimeMs,
    documents,
    summary: {
      total: entries.length,
      indexed: documents.length,
      needsConversion: entries.filter(entry => entry.state === 'needs_conversion').length,
      errors: entries.filter(entry => entry.state === 'error').length,
      characters: documents.reduce((sum, entry) => sum + entry.characters, 0),
    },
  };
  return cachedIndex;
}

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
