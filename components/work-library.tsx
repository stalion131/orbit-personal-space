'use client';
import { useEffect, useState } from 'react';
import {
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  Search,
} from 'lucide-react';
import { downloadWorkFile, workApi } from '@/lib/work-client';
type Item = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  extension: string;
  size: number | null;
};
type Listing = {
  enabled: boolean;
  rootName?: string;
  path?: string;
  items: Item[];
};
type Results = {
  enabled: boolean;
  available: boolean;
  summary?: { indexed: number; needsConversion: number; errors: number };
  results: { path: string; name: string; snippet: string }[];
};
export function WorkLibrary({ token }: { token: string | null }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<Results | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async (path = '') => {
    setBusy(true);
    setError('');
    try {
      setListing(
        await workApi<Listing>(
          `/api/work-files?path=${encodeURIComponent(path)}`,
          token,
        ),
      );
      setResults(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось открыть библиотеку.',
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void workApi<Listing>('/api/work-files', token)
      .then(setListing)
      .catch(() => setError('Не удалось открыть библиотеку.'));
  }, [token]);
  const search = async () => {
    setBusy(true);
    setError('');
    try {
      setResults(
        await workApi<Results>(
          `/api/work-search?q=${encodeURIComponent(query)}`,
          token,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка поиска.');
    } finally {
      setBusy(false);
    }
  };
  const download = (item: { name: string; path: string }) =>
    void downloadWorkFile(item.path, item.name, token).catch((e) =>
      setError(e.message),
    );
  return (
    <section className="work-library-v2" id="work-library">
      <header>
        <div>
          <span className="eyebrow">ЛОКАЛЬНЫЕ МАТЕРИАЛЫ</span>
          <h2>
            <HardDrive />
            Библиотека ППР и ТК
          </h2>
        </div>
        <button
          className="quiet-btn"
          onClick={() => void load()}
          disabled={busy}
        >
          Обновить
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {!listing ? (
        <p className="hint">Загружаем библиотеку…</p>
      ) : !listing.enabled ? (
        <p className="hint">
          Файлы с компьютера доступны в локальной версии Orbit. Путь в ТЗ не
          открывает доступ к диску с Vercel.
        </p>
      ) : (
        <>
          <nav className="library-breadcrumb">
            <button onClick={() => void load('')} disabled={busy}>
              {listing.rootName || 'Библиотека'}
            </button>
            {(listing.path || '')
              .split('/')
              .filter(Boolean)
              .map((part, i, all) => (
                <button
                  key={i}
                  onClick={() => void load(all.slice(0, i + 1).join('/'))}
                  disabled={busy}
                >
                  / {part}
                </button>
              ))}
          </nav>
          <form
            className="library-search-v2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input
              aria-label="Поиск в библиотеке"
              placeholder="Найти раздел или технологию в файлах"
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="quiet-btn"
              disabled={busy || query.trim().length < 2}
            >
              <Search />
              Найти
            </button>
            {results && (
              <button
                type="button"
                className="quiet-btn"
                onClick={() => setResults(null)}
              >
                К файлам
              </button>
            )}
          </form>
          {results ? (
            <div className="library-search-results">
              {!results.available && <p>Индекс ещё не создан.</p>}
              {results.summary && (
                <p className="hint">
                  Распознано {results.summary.indexed} · Требуют преобразования{' '}
                  {results.summary.needsConversion} · Ошибки{' '}
                  {results.summary.errors}
                </p>
              )}
              {results.results.map((item) => (
                <article key={item.path}>
                  <FileText />
                  <div>
                    <strong>{item.name}</strong>
                    <p>{item.snippet}</p>
                    <small>{item.path}</small>
                  </div>
                  <button
                    className="icon-btn"
                    aria-label={`Скачать ${item.name}`}
                    onClick={() => download(item)}
                  >
                    <Download />
                  </button>
                </article>
              ))}
              {results.available && !results.results.length && (
                <p>Ничего не найдено. Попробуйте другой запрос.</p>
              )}
            </div>
          ) : (
            <div className="library-file-grid">
              {listing.items.map((item) => (
                <button
                  className="quiet-btn"
                  key={item.path}
                  disabled={busy}
                  onClick={() =>
                    item.kind === 'directory'
                      ? void load(item.path)
                      : download(item)
                  }
                >
                  {item.kind === 'directory' ? <FolderOpen /> : <Download />}
                  <span>
                    {item.name}
                    <small>
                      {item.kind === 'directory'
                        ? 'Папка'
                        : `${item.extension} · ${Math.round((item.size || 0) / 1024)} КБ`}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="hint">
            Оригиналы доступны только для чтения. Новые файлы положите в
            разрешённую локальную папку; индекс обновляется отдельно.
          </p>
        </>
      )}
    </section>
  );
}
