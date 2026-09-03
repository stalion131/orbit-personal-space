import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative as relativePath, resolve } from 'node:path';
import { TaskError } from './tasks';

function isLoopback(hostname: string) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
}

export async function localFilesRoot(request: Request) {
  const url = new URL(request.url);
  if (!isLoopback(url.hostname) || url.protocol !== 'http:') return null;
  const configured = process.env.ORBIT_LOCAL_FILES_ROOT?.trim();
  if (!configured) return null;
  const root = await realpath(resolve(configured)).catch(() => '');
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new TaskError('Локальная папка библиотеки не найдена.', 503);
  return root;
}

export function containedPath(root: string, candidate: string) {
  if (candidate.includes('\0') || isAbsolute(candidate)) throw new TaskError('Некорректный путь.', 400);
  const target = resolve(root, candidate.replaceAll('/', '\\'));
  const relative = relativePath(root, target);
  if (relative.startsWith('..') || isAbsolute(relative)) throw new TaskError('Доступ за пределами библиотеки запрещён.', 403);
  return target;
}

export async function containedRealPath(root: string, candidate: string) {
  const target = containedPath(root, candidate);
  const canonical = await realpath(target).catch(() => { throw new TaskError('Папка или файл не найдены.', 404); });
  const relative = relativePath(root, canonical);
  if (relative.startsWith('..') || isAbsolute(relative)) throw new TaskError('Доступ за пределами библиотеки запрещён.', 403);
  return canonical;
}

export function browserPath(root: string, target: string) {
  return relativePath(root, target).split('\\').join('/');
}
