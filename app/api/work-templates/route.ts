import { authorize, failure, json } from '@/lib/http';
import { localFilesRoot } from '@/lib/local-files';
import { loadIndex } from '@/lib/local-template-index';
import { readTemplatePreview } from '@/lib/local-template-preview';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await authorize(request);
    if (!await localFilesRoot(request)) return json({ enabled: false, configured: false, templates: [] });
    const path = new URL(request.url).searchParams.get('path');
    if (path) return json({ preview: await readTemplatePreview(request, path) });
    const index = await loadIndex();
    return json({ enabled: true, configured: Boolean(process.env.OPENAI_API_KEY?.trim()), templates: index?.documents
      .filter(item => item.content.trim() && ['.docx', '.pdf'].includes(item.extension.toLowerCase()))
      .map(item => ({ path: item.path, name: item.name, characters: item.characters })) || [] });
  } catch (error) { return failure(error); }
}
