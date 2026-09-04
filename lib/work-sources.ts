export const SOURCE_FILE_BYTES = 2_500_000;
export const SOURCE_BATCH_BYTES = 2_800_000;
export const SOURCE_BATCH_COUNT = 8;
export const SOURCE_BATCH_TEXT = 300_000;
export const SOURCE_FOLDER_FILES = 2000;

export const sourcePurposes = {
  unspecified: 'Уточнить по содержимому',
  construction_contract: 'Договор на строительные работы',
  ppr_contract: 'Договор на разработку ППР',
  quantities: 'Ведомость / смета / выполненные работы',
  other: 'Другие исходные данные',
} as const;
export type SourcePurpose = keyof typeof sourcePurposes;
export function readSourcePurpose(value: unknown): SourcePurpose {
  if (value === undefined) return 'unspecified';
  if (typeof value !== 'string' || !Object.hasOwn(sourcePurposes, value))
    throw new Error('Выберите назначение источника из списка.');
  return value as SourcePurpose;
}

// A reference opened by the user, never a server-side fetch target.
export function readSourceFolderUrl(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 2000)
    throw new Error('Проверьте ссылку на папку: не более 2000 символов.');
  for (const c of value) {
    if (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
      throw new Error('Удалите управляющие символы из ссылки.');
  }
  const text = value.trim();
  if (!text) return '';
  if (/^[a-z]:[\\/]|^\\\\|^file:/i.test(text))
    throw new Error(
      'В поле «Ссылка на папку» указан локальный путь. Перенесите его в «Рабочая папка», а ссылку оставьте пустой.',
    );
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(
      'Введите полную HTTPS-ссылку. Путь D: укажите в поле «Рабочая папка».',
    );
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password
  )
    throw new Error(
      'Нужна HTTPS-ссылка без логина и пароля. Не вставляйте API-ключи.',
    );
  return url.href;
}
export function sourceFolderIssue(value: unknown): string {
  try {
    readSourceFolderUrl(value);
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : 'Проверьте ссылку на папку.';
  }
}

export function sourceFileIssue(file: { name: string; size: number }): string {
  if (file.name.startsWith('~$') || file.name.startsWith('.'))
    return 'Служебный файл';
  if (/\.(doc|xls|xlsm|docm)$/i.test(file.name))
    return 'Сохраните копию в DOCX / XLSX без макросов';
  if (!/\.(docx|xlsx|pdf|txt)$/i.test(file.name))
    return 'Для разбора нужен DOCX, XLSX, PDF или TXT';
  if (!Number.isSafeInteger(file.size) || file.size < 1)
    return 'Файл пуст или недоступен';
  if (file.size > SOURCE_FILE_BYTES)
    return 'Больше 2,5 МБ — нужен отдельный фрагмент';
  return '';
}

export function sourceBatchIssue(
  files: { name: string; size: number }[],
): string {
  if (!files.length) return 'Выберите файлы для разбора.';
  if (files.length > SOURCE_BATCH_COUNT)
    return `За один раз можно разобрать до ${SOURCE_BATCH_COUNT} файлов.`;
  for (const file of files) {
    const issue = sourceFileIssue(file);
    if (issue) return `${file.name}: ${issue}.`;
  }
  if (files.reduce((n, file) => n + file.size, 0) > SOURCE_BATCH_BYTES)
    return 'Общий размер выбранных файлов должен быть не больше 2,8 МБ.';
  return '';
}
