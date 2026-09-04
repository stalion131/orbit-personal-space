import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { authorize, failure } from '@/lib/http';
import { containedRealPath, localFilesRoot } from '@/lib/local-files';
import { TaskError } from '@/lib/tasks';

export const runtime = 'nodejs';

const mime: Record<string, string> = {
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function GET(request: Request) {
  try {
    await authorize(request);
    const root = await localFilesRoot(request);
    if (!root) throw new TaskError('Локальная библиотека доступна только на вашем компьютере.', 404);
    const relative = new URL(request.url).searchParams.get('path') || '';
    const target = await containedRealPath(root, relative);
    const info = await stat(target);
    if (!info.isFile()) throw new TaskError('Файл не найден.', 404);
    const name = basename(target);
    const extension = name.split('.').pop()?.toLocaleLowerCase() || '';
    // The source endpoint opens originals for reading only; no write API exists.
    return new Response(Readable.toWeb(createReadStream(target, { flags: 'r' })) as ReadableStream, {
      headers: {
        'Content-Type': mime[extension] || 'application/octet-stream',
        'Content-Length': String(info.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) { return failure(error); }
}
