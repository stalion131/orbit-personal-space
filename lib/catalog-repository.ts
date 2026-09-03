import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultCatalog, normalizeCatalog, orderedCatalog, TaskError, withHealthSphere, withPprDirection, type Catalog } from './tasks';

let localCatalog: Catalog = structuredClone(defaultCatalog);
const clone = (catalog: Catalog) => structuredClone(catalog);

function withSystemEntries(catalog: Catalog) { return withPprDirection(withHealthSphere(catalog)); }
export async function getLocalCatalog() { return withSystemEntries(clone(localCatalog)); }
export async function saveLocalCatalog(catalog: Catalog, revision: number) {
  if (localCatalog.revision !== revision) throw new TaskError('Каталог изменился в другой вкладке. Обновите страницу.', 409);
  localCatalog = { ...normalizeCatalog(catalog), revision: revision + 1 };
  return clone(localCatalog);
}

type CatalogRow = { payload: Catalog; revision: number };
export async function getCloudCatalog(client: SupabaseClient, ownerId: string) {
  const { data, error } = await client.from('orbit_catalogs').select('payload, revision').eq('owner_id', ownerId).maybeSingle();
  if (error) throw new TaskError('Не удалось получить каталог сфер.', 502);
  if (!data) return clone(defaultCatalog);
  return withSystemEntries({ ...orderedCatalog(normalizeCatalog((data as CatalogRow).payload)), revision: (data as CatalogRow).revision });
}
export async function saveCloudCatalog(client: SupabaseClient, ownerId: string, catalog: Catalog, revision: number) {
  const normalized = normalizeCatalog(catalog);
  const next = { ...normalized, revision: revision + 1 };
  const { data: existing, error: readError } = await client.from('orbit_catalogs').select('revision').eq('owner_id', ownerId).maybeSingle();
  if (readError) throw new TaskError('Не удалось сохранить каталог сфер.', 502);
  if (!existing) {
    if (revision !== defaultCatalog.revision) throw new TaskError('Каталог изменился. Обновите страницу.', 409);
    const { error } = await client.from('orbit_catalogs').insert({ owner_id: ownerId, payload: next, revision: next.revision, updated_at: new Date().toISOString() });
    if (error) throw new TaskError('Не удалось сохранить каталог сфер.', error.code === '23505' ? 409 : 502);
  } else {
    const { data, error } = await client.from('orbit_catalogs').update({ payload: next, revision: next.revision, updated_at: new Date().toISOString() }).eq('owner_id', ownerId).eq('revision', revision).select('owner_id');
    if (error) throw new TaskError('Не удалось сохранить каталог сфер.', 502);
    if (!data?.length) throw new TaskError('Каталог изменился в другой вкладке. Обновите страницу.', 409);
  }
  return next;
}
