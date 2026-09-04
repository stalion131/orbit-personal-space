'use client';
/* oxlint-disable react-compiler/effect-set-state */
import { useEffect, useState } from 'react';
import { workApi } from '@/lib/work-client';
import { wireFile } from '@/lib/work-file-cache';
import { safeNtdUrl, type NtdLibraryReply } from '@/lib/ntd-types';

export function NtdLibraryPanel({ token }: { token: string | null }) {
  const [reply, setReply] = useState<NtdLibraryReply | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null),
    [query, setQuery] = useState('');
  const [kind, setKind] = useState<'records' | 'permits'>('records'),
    [limit, setLimit] = useState(20);
  useEffect(() => {
    let alive = true;

    workApi<NtdLibraryReply>('/api/ntd-library', token)
      .then((v) => {
        if (alive) setReply(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [token]);
  const library = reply?.library;
  const records = (library?.[kind] || []).filter((r) =>
    Object.values(r.fields)
      .join(' ')
      .toLocaleLowerCase('ru')
      .includes(query.trim().toLocaleLowerCase('ru')),
  );
  const importFile = async () => {
    if (!file || !reply || busy) return;
    setBusy(true);
    setError('');

    try {
      setReply(
        await workApi<NtdLibraryReply>('/api/ntd-library', token, {
          method: 'POST',
          body: JSON.stringify({
            file: await wireFile(file),
            version: reply.version,
            confirm: true,
          }),
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось импортировать реестр.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ntd-library-panel">
      <h2>Библиотека нормативных документов</h2>
      <p>
        Реестр для поиска и отбора источников. Полные тексты и автоматический
        нормативный контроль пока не подключены.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!reply && !error && <output>Загружаем библиотеку…</output>}
      {reply && (
        <>
          <div className="ntd-import-bar">
            <label>
              Обновить из Excel
              <input
                type="file"
                accept=".xlsx"
                aria-label="Реестр НТД Excel"
                disabled={busy}
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (
                    selected &&
                    (selected.size > 2500000 || !/\.xlsx$/i.test(selected.name))
                  ) {
                    setError('Выберите XLSX до 2,5 МБ.');
                    return;
                  }
                  setFile(selected || null);
                }}
              />
            </label>
            <button
              className="primary-btn"
              disabled={!file || busy}
              onClick={() => void importFile()}
            >
              {busy
                ? 'Импортируем…'
                : library
                  ? 'Сохранить новую версию'
                  : 'Подключить реестр'}
            </button>
          </div>
          <p className="hint">
            {file?.name ||
              'Выберите книгу с листами «01_База НТД» и «05_Наряды-допуски».'}{' '}
            Файл передаётся для чтения только по кнопке. В OpenAI не
            отправляется.{' '}
            {reply.mode === 'local'
              ? 'Локальная база временная.'
              : 'Данные доступны только вашему аккаунту; прежние версии сохраняются.'}
          </p>
          {library ? (
            <>
              <output>
                Подключено: {library.records.length} записей НТД ·{' '}
                {library.permits.length} сценариев допуска · версия{' '}
                {reply.version}
              </output>
              <p className="hint">
                {library.name} · импорт{' '}
                {new Date(library.importedAt).toLocaleString('ru-RU')}
              </p>
              <details>
                <summary>Ограничения реестра</summary>
                {library.warnings.map((w, i) => (
                  <p className="hint" key={i}>
                    {w}
                  </p>
                ))}
              </details>
              <div className="ntd-search-bar">
                <input
                  aria-label="Поиск по НТД"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLimit(20);
                  }}
                  placeholder="СП, номер документа, вид работ…"
                />
                <select
                  aria-label="Раздел библиотеки НТД"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as typeof kind);
                    setLimit(20);
                  }}
                >
                  <option value="records">Нормативные документы</option>
                  <option value="permits">Наряды-допуски</option>
                </select>
              </div>
              <p className="hint">
                Найдено: {records.length}. Статус и основания ниже приведены по
                Excel, без независимой проверки.
              </p>
              <div className="ntd-results">
                {records.slice(0, limit).map((r) => (
                  <details key={r.id}>
                    <summary>
                      <strong>{r.fields['Документ'] || r.id}</strong>{' '}
                      {r.fields['Наименование'] || r.fields['Вид работ']}
                    </summary>
                    <p className="hint">
                      Источник: {r.sheet}, строка {r.row}
                    </p>
                    <dl>
                      {Object.entries(r.fields)
                        .filter(([k]) => k !== 'ID')
                        .map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>
                              {[
                                'Официальный источник',
                                'Текст для сверки',
                              ].includes(k) && safeNtdUrl(v) ? (
                                <a
                                  href={safeNtdUrl(v)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Открыть источник
                                </a>
                              ) : (
                                v || 'Не указано'
                              )}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </details>
                ))}
              </div>
              {records.length > limit && (
                <button
                  className="quiet-btn"
                  onClick={() => setLimit(limit + 20)}
                >
                  Показать ещё 20
                </button>
              )}
            </>
          ) : (
            <p>Реестр ещё не подключён к этому аккаунту.</p>
          )}
        </>
      )}
    </section>
  );
}
