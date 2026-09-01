import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runtimeConfig } from './runtime';
import { TaskError } from './tasks';

export type Access =
  | { mode: 'local' }
  | { mode: 'supabase'; userId: string; email: string; client: SupabaseClient };

function isLoopback(hostname: string) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
}

export async function authorize(request: Request): Promise<Access> {
  const url = new URL(request.url);
  const config = runtimeConfig();

  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new TaskError('Запрос с другого сайта запрещён.', 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) throw new TaskError('Источник запроса не разрешён.', 403);
  if (request.headers.get('x-orbit-client') !== 'dashboard') throw new TaskError('Отсутствует заголовок клиента.', 403);

  if (config.mode === 'local') {
    if (!isLoopback(url.hostname) || url.protocol !== 'http:') throw new TaskError('Локальная база недоступна из интернета.', 403);
    return { mode: 'local' };
  }

  if (url.protocol !== 'https:' && !isLoopback(url.hostname)) throw new TaskError('Для облачного доступа требуется HTTPS.', 403);
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) throw new TaskError('Войдите в личное пространство.', 401);
  const token = authorization.slice(7);
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new TaskError('Сессия истекла. Войдите снова.', 401);
  return { mode: 'supabase', userId: data.user.id, email: data.user.email ?? '', client };
}

export async function body(request: Request, maximumBytes = 32768): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new TaskError('Ожидается JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new TaskError('Пустой запрос.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new TaskError('Запрос слишком большой.', 413);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new TaskError('Некорректный JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TaskError('Ожидается объект JSON.');
  return parsed as Record<string, unknown>;
}

export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export function failure(error: unknown) {
  if (error instanceof TaskError) return json({ error: error.message }, error.status);
  console.error('Orbit API error', error instanceof Error ? error.message : 'unknown');
  return json({ error: 'Сервис временно недоступен. Повторите попытку позже.' }, 500);
}
