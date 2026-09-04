'use client';
/* oxlint-disable react/react-compiler, react-compiler/effect-set-state, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from 'react';
import {
  FileUp,
  Download,
  Sparkles,
  BookCheck,
  LoaderCircle,
} from 'lucide-react';
import type { Task } from '@/lib/tasks';
import {
  fieldLabels,
  fieldValue,
  hasSignatoryPosition,
  PPR_MODEL,
  type BriefField,
  type TextBlock,
} from '@/lib/ppr-workspace';
import { readWorkBrief, isBriefApproved } from '@/lib/work-brief';
import { buildPprSectionPlan } from '@/lib/ppr-methodology';
import { draftableSectionIds } from '@/lib/ppr-drafts';
import { workApi } from '@/lib/work-client';
import { PprSourcePicker } from '@/components/ppr-source-picker';
import {
  sourceBatchIssue,
  sourcePurposes,
  SOURCE_BATCH_TEXT,
  type SourcePurpose,
} from '@/lib/work-sources';
import {
  cacheWorkFile,
  cachedWorkFile,
  downloadDocx,
  fileFromWire,
  wireFile,
} from '@/lib/work-file-cache';

type Inspection = {
  file: {
    hash: string;
    name: string;
    characters: number;
    blocks: TextBlock[];
    warnings: string[];
    sheets: { name: string; cells: number; hidden: boolean }[];
  };
  paragraphs: {
    id: string;
    text: string;
    heading: boolean;
    topLevel: boolean;
  }[];
};
type Reply = {
  task?: Task;
  file?: { name: string; base64: string; hash: string };
};
export function PprDocumentWorkspace({
  task,
  token,
  locked,
  onSaved,
  onBusyChange,
}: {
  task: Task;
  token: string | null;
  locked: boolean;
  onSaved: (task: Task) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [tab, setTab] = useState('sources'),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sources, setSources] = useState<File[]>([]),
    [previews, setPreviews] = useState<Inspection[]>([]);
  const [purposes, setPurposes] = useState<Record<string, SourcePurpose>>({});
  const [base, setBase] = useState<File | null>(null),
    [inspection, setInspection] = useState<Inspection | null>(null);
  const [corrected, setCorrected] = useState<File | null>(null),
    [original, setOriginal] = useState<File | null>(null);
  const [consent, setConsent] = useState(false),
    [assemblyConsent, setAssemblyConsent] = useState(false);
  const [fields, setFields] = useState<BriefField[]>([]),
    [blocks, setBlocks] = useState<string[]>([]);
  const [sectionId, setSectionId] = useState('general'),
    [draftId, setDraftId] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState('');
  const [versionId, setVersionId] = useState(''),
    [rule, setRule] = useState(''),
    [indices, setIndices] = useState<number[]>([]);
  const active = useRef<AbortController | null>(null);
  const [experienceId, setExperienceId] = useState('');
  const api = `/api/tasks/${task.id}/ppr-workspace`;
  const project = task.workProject!;
  const workspace = task.pprWorkspace;
  const analysis = workspace?.analyses.at(-1),
    approval = task.briefApprovals?.at(-1);
  const pendingExperience =
    workspace?.experience.filter((e) => !e.confirmedAt) || [];
  const experience =
    pendingExperience.find((e) => e.id === experienceId) ||
    pendingExperience.at(-1);
  const versions = workspace?.versions || [];
  const currentDrafts = (task.pprDrafts || []).filter(
    (d) => d.briefId === approval?.id,
  );
  const selectedDraft = currentDrafts.find((d) => d.id === draftId);
  const approved = isBriefApproved(task, project);
  const brief = readWorkBrief(project.brief, project);
  useEffect(() => {
    setSources([]);
    setPreviews([]);
  }, [brief.workingFolder]);
  useEffect(() => {
    const controller = new AbortController();
    workApi<{ configured: boolean }>('/api/agents/ppr-status', token, {
      signal: controller.signal,
    })
      .then((v) => setConfigured(v.configured))
      .catch(() => setConfigured(null));
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [task.id, token]);
  useEffect(() => {
    setConsent(false);
    setAssemblyConsent(false);
  }, [task.revision, sources, purposes, base, blocks, sectionId, draftId, tab]);
  useEffect(() => {
    setFields(
      (analysis?.proposals || [])
        .filter(
          (p) =>
            !fieldValue(project, brief, p.field) ||
            fieldValue(project, brief, p.field) === 'unknown' ||
            (p.field.endsWith('.position') &&
              !hasSignatoryPosition(fieldValue(project, brief, p.field))),
        )
        .map((p) => p.field),
    );
  }, [analysis?.id]);
  useEffect(() => {
    setIndices([]);
    setRule('');
  }, [experience?.id]);
  const post = async (data: Record<string, unknown>) =>
    workApi<Reply>(api, token, {
      method: 'POST',
      body: JSON.stringify({ ...data, revision: task.revision }),
      signal: active.current?.signal,
    });
  const run = async (fn: () => Promise<void>) => {
    if (active.current || locked || pickerBusy) return;
    active.current = new AbortController();
    setBusy(true);
    onBusyChange(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось выполнить действие.',
      );
    } finally {
      active.current = null;
      setBusy(false);
      onBusyChange(false);
    }
  };
  const accept = (reply: Reply) => {
    if (reply.task) onSaved(reply.task);
  };
  const toggle = <T,>(values: T[], value: T) =>
    values.includes(value)
      ? values.filter((v) => v !== value)
      : [...values, value];
  const consentControl = (
    <label className="ppr-consent">
      <input
        type="checkbox"
        checked={consent}
        onChange={(e) => setConsent(e.target.checked)}
      />
      Разрешаю отправить выбранный текст, сохранённое ТЗ и подтверждённые
      примеры этого проекта в OpenAI. Запуск SOL расходует средства API.
    </label>
  );
  const inspect = async (
    file: File,
    revision = task.revision,
  ): Promise<Inspection> =>
    workApi(api, token, {
      method: 'POST',
      body: JSON.stringify({
        op: 'inspect',
        revision,
        file: await wireFile(file),
      }),
      signal: active.current?.signal,
    });
  const remember = async (file: File, hash: string) => {
    try {
      await cacheWorkFile(task.id, hash, file);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : 'Сохраните файл на компьютере.',
      );
    }
  };
  return (
    <section className="ppr-document-flow" aria-label="Исходные данные и Word">
      <header>
        <div>
          <span className="eyebrow">РАЗРАБОТЧИК ППР · SOL</span>
          <h3>От исходных данных к документу</h3>
        </div>
        <span className="badge">
          {connected
            ? 'SOL ответила · подключено'
            : configured === true
              ? 'API-ключ настроен'
              : configured === false
                ? 'Нужен API-ключ'
                : 'Доступ не проверен'}
        </span>
      </header>
      <p className="muted">
        Модель: {PPR_MODEL}. Наличие ключа не гарантирует доступ к модели.
        Проверка выполняется при запуске.
      </p>
      <button
        className="quiet-btn"
        disabled={busy || pickerBusy || locked || configured !== true}
        onClick={() =>
          void run(async () => {
            await post({ op: 'probe', confirmConnection: true });
            setConnected(true);
            setNotice(
              'SOL ответила. Данные проекта и файлы в проверке не передавались.',
            );
          })
        }
      >
        Проверить SOL без данных проекта
      </button>
      {locked && (
        <p className="ppr-warning">
          Сохраните изменения ТЗ или дождитесь текущего действия.
        </p>
      )}
      {(busy || pickerBusy) && (
        <output className="ppr-busy">
          <LoaderCircle className="spin" />
          Обрабатываю. Повторно нажимать не нужно.
        </output>
      )}
      {error && (
        <p role="alert" className="ppr-warning">
          {error}
        </p>
      )}
      {notice && <output className="ppr-notice">{notice}</output>}
      <fieldset
        disabled={locked || busy || pickerBusy}
        className="workspace-fieldset"
      >
        <nav className="ppr-flow-tabs" aria-label="Этапы работы с документами">
          {[
            ['sources', '1. Исходные данные'],
            ['word', '2. Word-документ'],
            ['experience', '3. Мои правки'],
          ].map(([id, title]) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              {title}
            </button>
          ))}
        </nav>
        {tab === 'sources' && (
          <div className="ppr-flow-panel">
            <h4>Прочитать файлы и предложить заполнение ТЗ</h4>
            <p>
              До 8 DOCX, XLSX, PDF или TXT; общий пакет до 2,8 МБ и 300 000
              знаков. Сканам нужно предварительное OCR. Нажмите «Прочитать»,
              чтобы увидеть текст до отправки ИИ.
            </p>
            <PprSourcePicker
              key={`${task.id}:${brief.workingFolder}`}
              taskId={task.id}
              token={token}
              url={project.sourceFolderUrl}
              folder={brief.workingFolder}
              sources={sources}
              disabled={locked || busy || pickerBusy}
              onChange={(files) => {
                setSources(files);
                setPreviews([]);
              }}
              onBusyChange={(value) => {
                setPickerBusy(value);
                onBusyChange(value);
              }}
            />
            <button
              className="quiet-btn"
              disabled={!sources.length}
              onClick={() =>
                void run(async () => {
                  const issue = sourceBatchIssue(sources);
                  if (issue) throw new Error(issue);
                  const values: Inspection[] = [];
                  for (const file of sources) {
                    const value = await inspect(file);
                    values.push(value);
                    await remember(file, value.file.hash);
                  }
                  setPreviews(values);
                  setNotice(
                    `Прочитано файлов: ${values.length}. Поля ТЗ не изменены. Укажите назначение договоров перед разбором.`,
                  );
                })
              }
            >
              Прочитать файлы
            </button>
            {previews.length > 0 && (
              <p className="muted">
                Прочитано{' '}
                {previews
                  .reduce((sum, p) => sum + p.file.characters, 0)
                  .toLocaleString('ru')}{' '}
                знаков. Чем больше текст, тем больше объём оплачиваемого вызова
                ИИ. В Excel используются сохранённые значения без пересчёта
                формул.
              </p>
            )}
            {previews.reduce((sum, p) => sum + p.file.characters, 0) >
              SOURCE_BATCH_TEXT && (
              <p role="alert">
                Пакет превышает 300 000 знаков. Выберите меньше файлов; текст не
                будет обрезан.
              </p>
            )}
            {previews.map((p) => (
              <div key={p.file.hash} className="ppr-source-entry">
                <label>
                  Назначение: {p.file.name}
                  <select
                    aria-label={`Назначение ${p.file.name}`}
                    value={purposes[p.file.hash] || 'unspecified'}
                    onChange={(e) =>
                      setPurposes({
                        ...purposes,
                        [p.file.hash]: e.target.value as SourcePurpose,
                      })
                    }
                  >
                    {Object.entries(sourcePurposes).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <details>
                  <summary>
                    {p.file.name} · {p.file.characters.toLocaleString('ru')}{' '}
                    знаков
                  </summary>
                  {p.file.sheets?.length > 0 && (
                    <p>
                      Листы:{' '}
                      {p.file.sheets
                        .map(
                          (s) =>
                            `${s.name} (${s.cells} ячеек${s.hidden ? ', скрыт' : ''})`,
                        )
                        .join(' · ')}
                    </p>
                  )}
                  {p.file.warnings?.map((w) => (
                    <p key={w} className="muted">
                      {w}
                    </p>
                  ))}
                  <div className="ppr-source-preview">
                    {p.file.blocks.map((b) => (
                      <p key={b.id}>
                        <small>{b.id}</small>
                        {b.text}
                      </p>
                    ))}
                  </div>
                </details>
              </div>
            ))}
            {consentControl}
            <button
              className="primary-btn"
              disabled={
                !consent ||
                configured !== true ||
                previews.length !== sources.length ||
                previews.reduce((sum, p) => sum + p.file.characters, 0) >
                  SOURCE_BATCH_TEXT ||
                !sources.length
              }
              onClick={() =>
                void run(async () => {
                  const files = [];
                  for (const [index, source] of sources.entries())
                    files.push({
                      ...(await wireFile(source)),
                      purpose:
                        purposes[previews[index].file.hash] || 'unspecified',
                    });
                  accept(
                    await post({
                      op: 'analyze',
                      files,
                      confirmDataTransfer: true,
                    }),
                  );
                  setNotice('Предложения готовы. Поля ТЗ ещё не изменены.');
                })
              }
            >
              <Sparkles />
              Предложить заполнение ТЗ
            </button>
            {analysis && (
              <section className="ppr-proposals">
                <h4>Проверка предложений</h4>
                <p>
                  Отмечены только пустые поля. Заполненное поле можно заменить,
                  выбрав его вручную. После применения изменённое ТЗ нужно
                  утвердить заново.
                </p>
                {analysis.proposals.map((p) => (
                  <label
                    aria-label={fieldLabels[p.field]}
                    key={p.field}
                    className="ppr-proposal"
                  >
                    <input
                      type="checkbox"
                      checked={fields.includes(p.field)}
                      onChange={() => setFields(toggle(fields, p.field))}
                    />
                    <span>
                      <strong>{fieldLabels[p.field]}</strong>
                      <span className="muted">
                        Сейчас:{' '}
                        {fieldValue(project, brief, p.field) || 'Не заполнено'}
                      </span>
                      <b>
                        {p.value === 'yes'
                          ? 'Да'
                          : p.value === 'no'
                            ? 'Нет'
                            : p.value}
                      </b>
                      <small>
                        {
                          analysis.files.find((f) => f.hash === p.fileHash)
                            ?.name
                        }{' '}
                        · {p.blockId}
                      </small>
                      <q>{p.quote}</q>
                      <small>{p.reason}</small>
                    </span>
                  </label>
                ))}
                {!analysis.proposals.length && (
                  <p>Подтверждённых сведений для заполнения не найдено.</p>
                )}
                {!!analysis.questions.length && (
                  <>
                    <h4>Нужно уточнить</h4>
                    <ul>
                      {analysis.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </>
                )}
                {analysis.warnings.map((w, i) => (
                  <p className="ppr-warning" key={i}>
                    {w}
                  </p>
                ))}
                <button
                  className="primary-btn"
                  disabled={
                    !fields.length ||
                    analysis.revision !== task.revision ||
                    !!analysis.applied.length
                  }
                  onClick={() =>
                    void run(async () => {
                      accept(
                        await post({
                          op: 'apply',
                          analysisId: analysis.id,
                          fields,
                        }),
                      );
                      setNotice(
                        'Выбранные поля сохранены. Проверьте и утвердите ТЗ.',
                      );
                    })
                  }
                >
                  Применить выбранные поля
                </button>
                {(analysis.revision !== task.revision ||
                  !!analysis.applied.length) && (
                  <small>
                    Разбор уже применён или ТЗ изменилось. Для нового заполнения
                    повторите анализ.
                  </small>
                )}
              </section>
            )}
          </div>
        )}
        {tab === 'word' && (
          <div className="ppr-flow-panel">
            <h4>Собрать рабочий DOCX из вашего шаблона</h4>
            <p>
              Файл сохраняет титул, стили, таблицы, колонтитулы и схемы.
              Заменяется только выбранная текстовая часть. Остальные части
              шаблона требуют адаптации. Все добавления синие; документ не
              считается проверенным НТД.
            </p>
            {!approved && (
              <p className="ppr-warning">
                Для разработки раздела и сборки утвердите актуальное ТЗ.
              </p>
            )}
            <label className="ppr-file-pick">
              <FileUp />
              Шаблон или сохранённая Word-версия
              <input
                type="file"
                accept=".docx"
                onChange={(e) => {
                  setBase(e.target.files?.[0] || null);
                  setInspection(null);
                  setBlocks([]);
                  setStart('');
                  setEnd('');
                }}
              />
            </label>
            <button
              className="quiet-btn"
              disabled={!base}
              onClick={() =>
                void run(async () => {
                  if (!base) return;
                  const value = await inspect(base);
                  setInspection(value);
                  await remember(base, value.file.hash);
                })
              }
            >
              Прочитать шаблон
            </button>
            {inspection && (
              <>
                <p>
                  {inspection.file.name} ·{' '}
                  {inspection.file.characters.toLocaleString('ru')} знаков
                </p>
                <label>
                  Раздел ППР
                  <select
                    value={sectionId}
                    onChange={(e) => setSectionId(e.target.value)}
                  >
                    {buildPprSectionPlan(project)
                      .filter((s) =>
                        draftableSectionIds.includes(
                          s.id as (typeof draftableSectionIds)[number],
                        ),
                      )
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                  </select>
                </label>
                <details>
                  <summary>
                    Выбрать фрагменты для SOL · {blocks.length} из 8
                  </summary>
                  <p>
                    Передаются только отмеченные фрагменты и ТЗ. До 1800 знаков
                    на фрагмент.
                  </p>
                  <div className="ppr-source-preview">
                    {inspection.file.blocks.map((b) => (
                      <label className="ppr-fragment" key={b.id}>
                        <input
                          type="checkbox"
                          disabled={
                            b.text.length > 1800 ||
                            (!blocks.includes(b.id) && blocks.length >= 8)
                          }
                          checked={blocks.includes(b.id)}
                          onChange={() => setBlocks(toggle(blocks, b.id))}
                        />
                        <span>
                          <small>
                            {b.id} · {b.text.length} знаков
                          </small>
                          {b.text}
                        </span>
                      </label>
                    ))}
                  </div>
                </details>
                {consentControl}
                <button
                  className="primary-btn"
                  disabled={
                    !approved ||
                    !consent ||
                    !blocks.length ||
                    configured !== true
                  }
                  onClick={() =>
                    void run(async () => {
                      if (!base) return;
                      const reply = await post({
                        op: 'generate',
                        sectionId,
                        blocks,
                        file: await wireFile(base),
                        confirmDataTransfer: true,
                      });
                      accept(reply);
                      setDraftId(reply.task?.pprDrafts?.at(-1)?.id || '');
                      setNotice(
                        'Раздел сохранён отдельной версией. Проверьте его перед сборкой.',
                      );
                    })
                  }
                >
                  <Sparkles />
                  Подготовить раздел с SOL
                </button>
                <hr />
                <h4>Вставить проверенный раздел в DOCX</h4>
                <label>
                  Версия текста
                  <select
                    value={draftId}
                    onChange={(e) => setDraftId(e.target.value)}
                  >
                    <option value="">Выберите подготовленный раздел</option>
                    {currentDrafts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.sectionTitle} · v{d.version}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedDraft && (
                  <details open>
                    <summary>Текст раздела для проверки</summary>
                    <div className="ppr-source-preview">
                      {selectedDraft.paragraphs.map((p, i) => (
                        <p
                          key={i}
                          className={p.changed ? 'ppr-changed-text' : ''}
                        >
                          {p.text}
                        </p>
                      ))}
                      {selectedDraft.questions.map((q, i) => (
                        <p key={`q${i}`} className="ppr-warning">
                          {q}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
                <div className="ppr-two-fields">
                  <label>
                    После какого заголовка
                    <select
                      value={start}
                      onChange={(e) => {
                        setStart(e.target.value);
                        setAssemblyConsent(false);
                      }}
                    >
                      <option value="">Начало текстовой части</option>
                      {inspection.paragraphs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.heading ? '§ ' : ''}
                          {p.text.slice(0, 100)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    До какого заголовка
                    <select
                      value={end}
                      onChange={(e) => {
                        setEnd(e.target.value);
                        setAssemblyConsent(false);
                      }}
                    >
                      <option value="">Конец текстовой части</option>
                      {inspection.paragraphs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.heading ? '§ ' : ''}
                          {p.text.slice(0, 100)}
                        </option>
                      ))}
                      <option value="end">До конца основного текста</option>
                    </select>
                  </label>
                </div>
                <label className="ppr-consent">
                  <input
                    type="checkbox"
                    checked={assemblyConsent}
                    onChange={(e) => setAssemblyConsent(e.target.checked)}
                  />
                  Проверил текст и границы: заменить абзацы между выбранными
                  заголовками, сохранить таблицы. Остальной шаблон ещё нужно
                  проверить и адаптировать.
                </label>
                <button
                  className="primary-btn"
                  disabled={
                    !approved ||
                    !selectedDraft ||
                    !start ||
                    !end ||
                    !assemblyConsent
                  }
                  onClick={() =>
                    void run(async () => {
                      if (!base) return;
                      const reply = await post({
                        op: 'assemble',
                        file: await wireFile(base),
                        sections: [{ draftId, start, end }],
                        confirmAssembly: true,
                      });
                      accept(reply);
                      if (reply.file) {
                        const file = fileFromWire(reply.file);
                        downloadDocx(file);
                        await remember(file, reply.file.hash);
                        setBase(file);
                        setInspection(
                          await inspect(file, reply.task?.revision),
                        );
                        setBlocks([]);
                        setStart('');
                        setEnd('');
                      }
                      setNotice(
                        'DOCX скачан. Для следующего раздела выберите его новую версию и диапазон.',
                      );
                    })
                  }
                >
                  <Download />
                  Собрать и скачать DOCX
                </button>
              </>
            )}
            <h4>История Word-версий</h4>
            <p className="muted">
              Копии файлов — на этом устройстве. Скачивайте важные версии:
              очистка браузера удаляет локальные копии.
            </p>
            {!versions.length && (
              <p>Здесь появятся сборки и исправленные DOCX.</p>
            )}
            {versions
              .slice()
              .reverse()
              .map((v) => (
                <div className="ppr-version" key={v.id}>
                  <span>
                    <strong>{v.name}</strong>
                    <small>
                      {v.kind === 'corrected' ? 'Ваши правки' : 'Сборка'} ·{' '}
                      {new Date(v.at).toLocaleString('ru')}
                    </small>
                  </span>
                  <button
                    className="quiet-btn"
                    onClick={() =>
                      void run(async () => {
                        const f = await cachedWorkFile(task.id, v.hash);
                        if (!f)
                          throw new Error(
                            'Файла нет в этом браузере. Используйте скачанную копию на компьютере.',
                          );
                        downloadDocx(f);
                      })
                    }
                  >
                    <Download />
                    Скачать
                  </button>
                </div>
              ))}
          </div>
        )}
        {tab === 'experience' && (
          <div className="ppr-flow-panel">
            <h4>Учесть ваши исправления</h4>
            <p>
              Загрузите исправленный DOCX и укажите, какую версию редактировали.
              Сравнивается текст; изменения оформления автоматически не
              становятся правилами. Опыт используется только в этом проекте
              после вашего подтверждения.
            </p>
            <label>
              Какая версия была основой
              <select
                value={versionId}
                onChange={(e) => {
                  setVersionId(e.target.value);
                  setOriginal(null);
                }}
              >
                <option value="">Выберите Word-версию</option>
                {versions.map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.name} · {new Date(v.at).toLocaleString('ru')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Исходная версия (если нет копии в браузере)
              <input
                type="file"
                accept=".docx"
                onChange={(e) => setOriginal(e.target.files?.[0] || null)}
              />
            </label>
            <label className="ppr-file-pick">
              <FileUp />
              Исправленный DOCX
              <input
                type="file"
                accept=".docx"
                onChange={(e) => setCorrected(e.target.files?.[0] || null)}
              />
            </label>
            <button
              className="primary-btn"
              disabled={!versionId || !corrected}
              onClick={() =>
                void run(async () => {
                  const version = versions.find((v) => v.id === versionId);
                  if (!version || !corrected) return;
                  const source =
                    original || (await cachedWorkFile(task.id, version.hash));
                  if (!source)
                    throw new Error(
                      'Загрузите исходную версию: в этом браузере её нет.',
                    );
                  if (source.size + corrected.size > 2800000)
                    throw new Error(
                      'Общий размер двух файлов должен быть до 2,8 МБ. Для больших документов разбирайте разделы отдельно.',
                    );
                  const reply = await post({
                    op: 'correct',
                    versionId,
                    original: await wireFile(source),
                    file: await wireFile(corrected),
                  });
                  accept(reply);
                  const saved = reply.task?.pprWorkspace?.versions.at(-1);
                  if (saved) await remember(corrected, saved.hash);
                  setNotice(
                    'Исправленный файл сохранён в истории. Опыт ещё не подтверждён.',
                  );
                })
              }
            >
              Сохранить версию и сравнить
            </button>
            {experience && (
              <section className="ppr-proposals">
                <h4>Что учитывать в следующих разделах</h4>
                <label>
                  Неподтверждённая версия
                  <select
                    value={experience.id}
                    onChange={(e) => setExperienceId(e.target.value)}
                  >
                    {pendingExperience.map((e) => (
                      <option key={e.id} value={e.id}>
                        {versions.find((v) => v.id === e.versionId)?.name} ·{' '}
                        {new Date(e.at).toLocaleString('ru')}
                      </option>
                    ))}
                  </select>
                </label>
                {experience.changes.map((c, i) => (
                  <label
                    aria-label={`Учитывать правку ${i + 1}`}
                    className="ppr-proposal"
                    key={i}
                  >
                    <input
                      type="checkbox"
                      checked={indices.includes(i)}
                      onChange={() => setIndices(toggle(indices, i))}
                    />
                    <span>
                      <small>Было</small>
                      <del>{c.before || 'Пусто'}</del>
                      <small>Стало</small>
                      <ins>{c.after || 'Удалено'}</ins>
                    </span>
                  </label>
                ))}
                {!experience.changes.length && (
                  <p>
                    Текст не изменился. Оформление сохранено в загруженном
                    файле, но не преобразовано в опыт.
                  </p>
                )}
                <label>
                  Ваше правило для разработчика ППР
                  <textarea
                    value={rule}
                    onChange={(e) => setRule(e.target.value)}
                    maxLength={1500}
                    placeholder="Что именно нужно учитывать и в каких случаях?"
                  />
                </label>
                <button
                  className="primary-btn"
                  disabled={!indices.length || !rule.trim()}
                  onClick={() =>
                    void run(async () => {
                      accept(
                        await post({
                          op: 'confirm_experience',
                          experienceId: experience.id,
                          rule,
                          indices,
                        }),
                      );
                      setNotice(
                        'Выбранные правки подтверждены. SOL получит их как примеры при следующем запуске по этому проекту.',
                      );
                    })
                  }
                >
                  <BookCheck />
                  Подтвердить выбранный опыт
                </button>
              </section>
            )}
            <h4>Подтверждённая память проекта</h4>
            {(workspace?.experience || [])
              .filter((e) => e.confirmedAt)
              .map((e) => (
                <details key={e.id}>
                  <summary>{e.rule}</summary>
                  <p>
                    {e.changes.length} примеров ·{' '}
                    {new Date(e.confirmedAt!).toLocaleString('ru')}
                  </p>
                </details>
              ))}
            <small>
              Это база подтверждённых примеров, а не обучение весов модели.
              Последние 8 правил (до 3 примеров каждого) передаются при запуске;
              все подтверждённые записи остаются в истории.
            </small>
          </div>
        )}
      </fieldset>
    </section>
  );
}
