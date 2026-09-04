'use client';
import { useEffect, useRef, useState } from 'react';
import {
  FolderOpen,
  Link2,
  FileUp,
  Search,
  ArrowLeft,
  Plus,
  Check,
  X,
} from 'lucide-react';
import { readLocalSourceFile, workApi } from '@/lib/work-client';
import {
  readSourceFolderUrl,
  sourceBatchIssue,
  sourceFileIssue,
  SOURCE_FOLDER_FILES,
} from '@/lib/work-sources';

type LocalItem = {
  name: string;
  path: string;
  downloadPath: string;
  kind: string;
  size: number;
};
type Listing = {
  enabled: boolean;
  configured?: boolean;
  folderName?: string;
  path?: string;
  items: LocalItem[];
  truncated?: boolean;
  unavailable?: number;
};
const sizeLabel = (size: number) =>
  size >= 1_000_000
    ? `${(size / 1_000_000).toFixed(1)} МБ`
    : `${Math.ceil(size / 1000)} КБ`;

export function PprSourcePicker({
  taskId,
  token,
  url,
  folder,
  sources,
  disabled,
  onChange,
  onBusyChange,
}: {
  taskId: string;
  token: string | null;
  url?: string;
  folder: string;
  sources: File[];
  disabled: boolean;
  onChange: (files: File[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [pool, setPool] = useState<File[]>([]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [listing, setListing] = useState<Listing | null>(null);
  const [localFiles, setLocalFiles] = useState<{ path: string; file: File }[]>(
    [],
  );
  const [mode, setMode] = useState<'browser' | 'local'>('browser');
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [taskId, token],
  );
  let href = '';
  try {
    href = readSourceFolderUrl(url);
  } catch {
    /* Unsaved invalid URLs are never rendered as links. */
  }
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (active.current || disabled) return;
    const controller = new AbortController();
    active.current = controller;
    onBusyChange(true);
    setNotice('');
    try {
      await fn(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted)
        setNotice(e instanceof Error ? e.message : 'Не удалось открыть папку.');
    } finally {
      active.current = null;
      if (!controller.signal.aborted) onBusyChange(false);
    }
  };
  const loadLocal = (path = '') =>
    void run(async (signal) => {
      const value = await workApi<Listing>(
        `/api/tasks/${taskId}/ppr-source-files?path=${encodeURIComponent(path)}`,
        token,
        { signal },
      );
      setListing(value);
      setMode('local');
      setQuery('');
    });
  const choose = (chosen: FileList | null, isFolder: boolean) => {
    if (!chosen?.length) return;
    if (chosen.length > SOURCE_FOLDER_FILES) {
      setNotice(
        'В папке больше 2000 файлов. Выберите подпапку конкретного проекта.',
      );
      return;
    }
    const files = Array.from(chosen).sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(
        b.webkitRelativePath || b.name,
        'ru',
      ),
    );
    setPool(files);
    setQuery('');
    setMode('browser');
    setLocalFiles([]);
    // Choosing a folder grants read access to the browser, not permission to upload it.
    onChange(!isFolder && !sourceBatchIssue(files) ? files : []);
    setNotice(
      isFolder
        ? 'Список получен. Содержимое не отправлено. Отметьте нужные файлы.'
        : 'Отметьте до 4 файлов для одного разбора.',
    );
  };
  const toggle = (file: File) => {
    if (sources.includes(file)) {
      onChange(sources.filter((f) => f !== file));
      setNotice('');
      return;
    }
    const next = [...sources, file],
      issue = sourceBatchIssue(next);
    if (issue) {
      setNotice(issue);
      return;
    }
    onChange(next);
    setNotice('');
  };
  const takeLocal = (item: LocalItem) => {
    const existing = localFiles.find((f) => f.path === item.downloadPath)?.file;
    if (existing && sources.includes(existing)) {
      toggle(existing);
      return;
    }
    const issue = sourceBatchIssue([...sources, item]);
    if (issue) {
      setNotice(issue);
      return;
    }
    void run(async (signal) => {
      const file = await readLocalSourceFile(
        item.downloadPath,
        item.name,
        token,
        signal,
      );
      const next = [...sources, file],
        changedIssue = sourceBatchIssue(next);
      if (changedIssue) throw new Error(changedIssue);
      setLocalFiles((values) => [
        ...values.filter((f) => f.path !== item.downloadPath),
        { path: item.downloadPath, file },
      ]);
      onChange(next);
    });
  };
  const matches = (text: string) =>
    text.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'));
  const visible = pool.filter((file) =>
    matches(file.webkitRelativePath || file.name),
  );
  const available = pool.filter((file) => !sourceFileIssue(file)).length;
  return (
    <section className="ppr-source-picker" aria-label="Папка исходных данных">
      <header>
        <FolderOpen />
        <div>
          <strong>Папка проекта</strong>
          <small>Ссылка, локальные файлы и выбор документов для SOL</small>
        </div>
      </header>
      <div className="ppr-source-location">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            <Link2 />
            Открыть ссылку на папку ↗<small>{new URL(href).hostname}</small>
          </a>
        ) : (
          <p className="muted">
            Ссылку можно добавить в ТЗ → «Графики и рабочие материалы».
          </p>
        )}
        {folder && (
          <p>
            <small>Рабочая папка</small>
            <span>{folder}</span>
          </p>
        )}
        <small>
          Ссылка и путь сохраняются с проектом. Содержимое папки автоматически
          не синхронизируется.
        </small>
      </div>
      <div className="ppr-source-actions">
        <label className="ppr-file-pick">
          <FolderOpen />
          Выбрать папку на компьютере
          <input
            aria-label="Выбрать папку на компьютере"
            type="file"
            multiple
            {...{ webkitdirectory: '' }}
            onChange={(e) => {
              choose(e.target.files, true);
              e.target.value = '';
            }}
            disabled={disabled}
          />
        </label>
        <label className="ppr-file-pick">
          <FileUp />
          Выбрать отдельные файлы
          <input
            aria-label="Выбрать отдельные исходные файлы"
            type="file"
            multiple
            accept=".docx,.pdf,.txt"
            onChange={(e) => {
              choose(e.target.files, false);
              e.target.value = '';
            }}
            disabled={disabled}
          />
        </label>
      </div>
      {folder && (
        <button
          className="quiet-btn"
          type="button"
          disabled={disabled}
          onClick={() => loadLocal()}
        >
          <FolderOpen />
          Открыть папку на локальном сервере
        </button>
      )}
      {mode === 'local' && listing && !listing.enabled && (
        <p className="ppr-warning">
          Сайт Vercel не видит диск D:. Нажмите «Выбрать папку на компьютере».
          Локальный каталог доступен только при запуске Orbit на этом
          компьютере.
        </p>
      )}
      {mode === 'local' && listing?.enabled && !listing.configured && (
        <p>Сначала сохраните рабочую папку в ТЗ.</p>
      )}
      {((mode === 'browser' && pool.length > 0) ||
        (mode === 'local' && listing?.configured)) && (
        <>
          <label className="ppr-file-search">
            <Search />
            <input
              aria-label="Поиск файла в выбранной папке"
              placeholder="Найти документ по имени или подпапке"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {mode === 'browser' ? (
            <>
              <p className="muted">
                В списке: {pool.length} · Можно выбрать для разбора: {available}{' '}
                · Ограничения: {pool.length - available}. Формат и размер
                проверены; содержимое ещё не прочитано.
              </p>
              <div className="ppr-source-file-list">
                {visible.slice(0, 200).map((file, index) => {
                  const issue = sourceFileIssue(file);
                  return (
                    <label
                      key={`${file.webkitRelativePath || file.name}-${index}`}
                      className={issue ? 'unavailable' : ''}
                    >
                      <input
                        type="checkbox"
                        checked={sources.includes(file)}
                        disabled={disabled || !!issue}
                        onChange={() => toggle(file)}
                      />
                      <span>
                        <strong>{file.name}</strong>
                        {file.webkitRelativePath && (
                          <small>{file.webkitRelativePath}</small>
                        )}
                        <small>
                          {sizeLabel(file.size)} · {issue || 'Можно выбрать'}
                        </small>
                      </span>
                    </label>
                  );
                })}
                {!visible.length && <p>По этому запросу файлов нет.</p>}
              </div>
              {visible.length > 200 && (
                <small>
                  Показаны первые 200 из {visible.length}. Уточните поиск.
                </small>
              )}
            </>
          ) : (
            <>
              <nav
                className="ppr-source-actions"
                aria-label="Навигация по папке проекта"
              >
                <strong>
                  {listing?.folderName} / {listing?.path}
                </strong>
                {!!listing?.path && (
                  <button
                    type="button"
                    className="quiet-btn"
                    onClick={() =>
                      loadLocal(listing.path!.split('/').slice(0, -1).join('/'))
                    }
                    disabled={disabled}
                  >
                    <ArrowLeft />
                    На уровень выше
                  </button>
                )}
              </nav>
              <div className="ppr-source-file-list">
                {listing?.items
                  .filter((item) => matches(item.name))
                  .map((item) => {
                    const issue =
                      item.kind === 'file' ? sourceFileIssue(item) : '';
                    const selected = localFiles.some(
                      (f) =>
                        f.path === item.downloadPath &&
                        sources.includes(f.file),
                    );
                    return (
                      <button
                        className="ppr-local-file"
                        type="button"
                        key={item.path}
                        disabled={disabled || !!issue}
                        onClick={() =>
                          item.kind === 'directory'
                            ? loadLocal(item.path)
                            : takeLocal(item)
                        }
                      >
                        {item.kind === 'directory' ? (
                          <FolderOpen />
                        ) : selected ? (
                          <Check />
                        ) : (
                          <Plus />
                        )}
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.kind === 'directory'
                              ? 'Открыть подпапку'
                              : `${sizeLabel(item.size)} · ${issue || (selected ? 'Выбран — нажмите, чтобы убрать' : 'Выбрать для разбора')}`}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                {!listing?.items.length && (
                  <p>В этой папке пока нет доступных файлов.</p>
                )}
              </div>
              {(listing?.truncated || !!listing?.unavailable) && (
                <p className="ppr-warning">
                  Часть элементов недоступна или список ограничен 500 записями.
                  Выберите подпапку. Доступ за пределы библиотеки закрыт.
                </p>
              )}
            </>
          )}
        </>
      )}
      {notice && <output className="ppr-warning">{notice}</output>}
      <div className="ppr-source-selection" aria-live="polite">
        <strong>
          Для разбора: {sources.length} из 4 ·{' '}
          {sizeLabel(sources.reduce((n, f) => n + f.size, 0))}
        </strong>
        {sources.map((file, index) => (
          <div key={index}>
            <span>{file.name}</span>
            <button
              type="button"
              className="icon-btn"
              disabled={disabled}
              aria-label={`Убрать ${file.name} из разбора`}
              onClick={() => toggle(file)}
            >
              <X />
            </button>
          </div>
        ))}
      </div>
      <small>
        В Vercel выбранные документы передаются только по кнопке «Прочитать
        файлы», в OpenAI — после отдельного разрешения. После обновления
        страницы папку нужно выбрать снова.
      </small>
    </section>
  );
}
