import { randomUUID } from 'node:crypto';
import { authorize, body, failure, json, type Access } from '@/lib/http';
import { TaskError } from '@/lib/tasks';
import { decodeFile } from '@/lib/ppr-docx';
import { importNtdRoadmap } from '@/lib/ntd-import';
import type { NtdLibrary } from '@/lib/ntd-types';

export const runtime = 'nodejs';
type Stored = { version: number; payload: NtdLibrary };
let local: Stored | null = null;
async function latest(access: Access): Promise<Stored | null> {
  if (access.mode === 'local') return local;
  const { data, error } = await access.client
    .from('orbit_ntd_libraries')
    .select('version,payload')
    .eq('owner_id', access.userId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new TaskError(
      'Библиотека НТД недоступна. Проверьте подключение и миграцию базы.',
      502,
    );
  return data;
}
export async function GET(request: Request) {
  try {
    const access = await authorize(request),
      entry = await latest(access);
    return json({
      version: entry?.version || 0,
      library: entry?.payload || null,
      mode: access.mode,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const access = await authorize(request),
      input = await body(request, 3_500_000);
    if (input.confirm !== true)
      throw new TaskError('Подтвердите импорт реестра.');
    const previous = await latest(access);
    if (input.version !== (previous?.version || 0))
      throw new TaskError(
        'Библиотека уже обновлена. Загрузите актуальную версию.',
        409,
      );

    let payload: NtdLibrary;
    try {
      const file = decodeFile(input.file);
      payload = importNtdRoadmap(file.name, file.bytes);
    } catch (e) {
      throw new TaskError(
        e instanceof Error ? e.message : 'Не удалось прочитать реестр.',
      );
    }
    if (previous?.payload.hash === payload.hash)
      return json({
        version: previous.version,
        library: previous.payload,
        mode: access.mode,
      });
    if ((previous?.version || 0) >= 50)
      throw new TaskError(
        'Сохранено 50 версий. Нужен архив перед расширением библиотеки.',
        409,
      );
    const next = { version: (previous?.version || 0) + 1, payload };
    if (access.mode === 'local') {
      if ((local?.version || 0) !== input.version)
        throw new TaskError('Библиотека уже обновлена.', 409);
      local = next;
    } else {
      const { error } = await access.client
        .from('orbit_ntd_libraries')
        .insert({ id: randomUUID(), owner_id: access.userId, ...next });
      if (error)
        throw new TaskError(
          error.code === '23505'
            ? 'Библиотека уже обновлена.'
            : 'Не удалось сохранить библиотеку НТД.',
          error.code === '23505' ? 409 : 502,
        );
    }
    return json({ version: next.version, library: payload, mode: access.mode });
  } catch (e) {
    return failure(e);
  }
}
