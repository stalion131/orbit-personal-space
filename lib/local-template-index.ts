import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { TaskError } from './tasks';

type IndexEntry = {
  path: string;
  sha256?: string;
  name: string;
  extension: string;
  state: 'indexed' | 'needs_conversion' | 'error';
  textFile: string | null;
  characters: number;
  headings: string[];
};

export type SearchDocument = IndexEntry & { content: string; searchable: string };
type SearchIndex = {
  root: string;
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

export async function loadIndex(fresh = false) {
  const root = await realpath(/*turbopackIgnore: true*/ indexDirectory()).catch(() => '');
  if (!root) return null;
  const manifestPath = await safeIndexFile(root, 'manifest.json');
  if (!manifestPath) return null;
  const manifestInfo = await stat(/*turbopackIgnore: true*/ manifestPath);
  if (manifestInfo.size > 5000000) throw new TaskError('Локальный индекс слишком большой.', 503);
  if (!fresh && cachedIndex?.root === root && cachedIndex.modifiedAt === manifestInfo.mtimeMs) return cachedIndex;

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
    if (textPath && (await stat(/*turbopackIgnore: true*/ textPath)).size > 2000000) throw new TaskError('Текст шаблона превышает лимит MVP.', 413);
    const content = textPath ? await readFile(/*turbopackIgnore: true*/ textPath, 'utf8') : '';
    const searchable = `${entry.name}\n${entry.path}\n${entry.headings.join('\n')}\n${content}`.toLocaleLowerCase('ru');
    return { ...entry, content, searchable };
  }));
  cachedIndex = {
    root,
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
