import { TaskError } from './tasks';
// This MVP has no remote authentication. Refuse non-loopback API access.
export function guard(request: Request) {
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw new TaskError('API доступен только локально.', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new TaskError('Запрос с другого сайта запрещён.', 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) throw new TaskError('Источник запроса не разрешён.', 403);
  if (request.headers.get('x-orbit-client') !== 'dashboard') throw new TaskError('Отсутствует заголовок клиента.', 403);
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new TaskError('Ожидается JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new TaskError('Пустой запрос.');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 32768) { await reader.cancel(); throw new TaskError('Запрос слишком большой.', 413); } chunks.push(value); }
  const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  let parsed: unknown; try { parsed = JSON.parse(new TextDecoder().decode(data)); } catch { throw new TaskError('Некорректный JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TaskError('Ожидается объект JSON.');
  return parsed as Record<string, unknown>;
}
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
export function failure(error: unknown) { return error instanceof TaskError ? json({error: error.message}, error.status) : json({error: 'Не удалось обратиться к локальной базе. Проверьте запуск сервера и миграции.'}, 500); }
