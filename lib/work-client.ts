export async function workApi<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Orbit-Client', 'dashboard');
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, {
    ...options,
    headers,
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || 'Не удалось выполнить действие.');
  return data as T;
}
export async function downloadWorkFile(
  path: string,
  name: string,
  token: string | null,
) {
  const headers = new Headers({ 'X-Orbit-Client': 'dashboard' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(
    `/api/work-files/download?path=${encodeURIComponent(path)}`,
    { headers, cache: 'no-store' },
  );
  if (!response.ok)
    throw new Error('Не удалось скачать файл. Проверьте доступ к библиотеке.');
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
