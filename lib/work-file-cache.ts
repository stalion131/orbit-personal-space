'use client';

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('orbit-ppr-files-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          'Браузер не разрешил сохранить копию. Скачайте файл на компьютер.',
        ),
      );
    request.onblocked = () =>
      reject(
        new Error('Закройте старые вкладки, чтобы открыть хранилище файлов.'),
      );
  });
}
export async function cacheWorkFile(taskId: string, hash: string, file: File) {
  const db = await openCache();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(file, `${taskId}:${hash}`);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(
          new Error(
            'Не удалось сохранить копию в браузере. Скачанный DOCX остаётся на компьютере.',
          ),
        );
    });
  } finally {
    db.close();
  }
}
export async function cachedWorkFile(
  taskId: string,
  hash: string,
): Promise<File | null> {
  const db = await openCache();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction('files')
        .objectStore('files')
        .get(`${taskId}:${hash}`);
      request.onsuccess = () =>
        resolve(
          request.result instanceof Blob ? (request.result as File) : null,
        );
      request.onerror = () =>
        reject(new Error('Не удалось прочитать копию файла в браузере.'));
    });
  } finally {
    db.close();
  }
}
export async function wireFile(file: File) {
  if (file.size > 2500000)
    throw new Error('Файл больше 2,5 МБ. Загрузите часть документа.');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result.split(',')[1])
        : reject(new Error('Не удалось прочитать файл.'));
    reader.onerror = () =>
      reject(new Error('Не удалось прочитать выбранный файл.'));
    reader.readAsDataURL(file);
  });
  return { name: file.name, base64 };
}
export function fileFromWire(value: { name: string; base64: string }) {
  return new File(
    [Uint8Array.from(atob(value.base64), (c) => c.charCodeAt(0))],
    value.name,
    {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  );
}
export function downloadDocx(file: File) {
  const url = URL.createObjectURL(file),
    a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
