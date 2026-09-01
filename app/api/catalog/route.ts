import { getCloudCatalog, getLocalCatalog, saveCloudCatalog, saveLocalCatalog } from '@/lib/catalog-repository';
import { authorize, body, failure, json } from '@/lib/http';
import { TaskError, type Catalog } from '@/lib/tasks';

export async function GET(request: Request) {
  try { const access = await authorize(request); const catalog = access.mode === 'supabase' ? await getCloudCatalog(access.client, access.userId) : await getLocalCatalog(); return json({ catalog }); }
  catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    const access = await authorize(request); const data = await body(request, 65536);
    if (!Number.isSafeInteger(data.revision) || !data.catalog || typeof data.catalog !== 'object') throw new TaskError('Передайте актуальную версию каталога.');
    const revision = Number(data.revision);
    const catalog = access.mode === 'supabase' ? await saveCloudCatalog(access.client, access.userId, data.catalog as Catalog, revision) : await saveLocalCatalog(data.catalog as Catalog, revision);
    return json({ catalog });
  } catch (error) { return failure(error); }
}
