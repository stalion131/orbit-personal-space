'use client';
/* oxlint-disable react/react-compiler, react-compiler/effect-set-state, react-hooks/exhaustive-deps */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { briefForAgent, isBriefApproved } from '@/lib/work-brief';
import { confirmedExperience } from '@/lib/ppr-workspace';
import { BookOpen, Check, Download, FilePenLine, LoaderCircle, Save, Search, Send, TriangleAlert } from 'lucide-react';
import { draftableSectionIds, draftHtml, markDraftParagraphs, MAX_SOURCE_CHARACTERS, type PprDraft, type SavedPprDraft, type TemplatePreview } from '@/lib/ppr-drafts';
import { buildPprSectionPlan, evaluatePprReadiness } from '@/lib/ppr-methodology';
import type { Task, WorkProject } from '@/lib/tasks';

type Props = {
  task: Task; project: WorkProject; token: string | null; cloud: boolean; sectionId: string;
  onTemplate: (path: string) => void; onSection: (id: string) => void; onSaveProject: () => void;
  onSaved: (task: Task) => void; projectSaving: boolean; embedded?: boolean; emptyPreview?: ReactNode; onBusyChange?: (busy: boolean) => void;
};
type TemplateList = { enabled: boolean; configured: boolean; templates: { path: string; name: string; characters: number }[] };

async function request<T>(path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Orbit-Client', 'dashboard'); headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить действие.');
  return data as T;
}

export function DraftText({ draft }: { draft: PprDraft | SavedPprDraft }) {
  return <div className="ppr-draft-text">{draft.paragraphs.map((paragraph, index) => <p className={paragraph.changed ? 'draft-changed' : ''} key={index}>{paragraph.text}</p>)}</div>;
}

export function PprSectionStudio({ task, project, token, cloud, sectionId, onTemplate, onSection, onSaveProject, onSaved, projectSaving, embedded, emptyPreview, onBusyChange }: Props) {
  const [library, setLibrary] = useState<TemplateList | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [chunkIds, setChunkIds] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(40);
  const [consentFor, setConsentFor] = useState('');
  const [saveConsent, setSaveConsent] = useState(false);
  const [pending, setPending] = useState<PprDraft | null>(null);
  const [savedId, setSavedId] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'generate' | 'save' | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef<AbortController | null>(null);
  const previewSequence = useRef(0);
  useEffect(() => { onBusyChange?.(!!busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const plan = buildPprSectionPlan(project);
  const allowed = draftableSectionIds.some(id => id === sectionId);
  const approved = isBriefApproved(task, project);
  const dirty = !task.workProject || JSON.stringify(project) !== JSON.stringify(task.workProject);
  const selected = preview?.path === project.baseTemplatePath ? preview.chunks.filter(item => chunkIds.includes(item.id)) : [];
  const selectedCharacters = selected.reduce((sum, item) => sum + item.text.length, 0);
  const context = JSON.stringify({ taskId: task.id, revision: task.revision, description: task.description, project, sectionId, textHash: preview?.textHash, sourceHash: preview?.sourceHash, chunkIds });
  const consent = consentFor === context;
  const versions = (task.pprDrafts || []).filter(item => item.sectionId === sectionId);
  const saved = versions.find(item => item.id === savedId) || versions.at(-1);
  const visible = pending || saved;
  const pendingStale = !!pending && (pending.sourceRevision !== task.revision || dirty || !approved || pending.sectionId !== sectionId);
  const chunks = preview?.path === project.baseTemplatePath ? preview.chunks.filter(item => !filter.trim() || item.text.toLocaleLowerCase('ru').includes(filter.trim().toLocaleLowerCase('ru'))) : [];

  const loadTemplates = async () => {
    try { setLibrary(await request<TemplateList>('/api/work-templates', token)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось прочитать список шаблонов.'); }
  };
  useEffect(() => { void loadTemplates(); return () => operation.current?.abort(); }, [token]);
  useEffect(() => { setConsentFor(''); setSaveConsent(false); setPending(null); setEditing(false); }, [sectionId]);
  useEffect(() => {
    if (busy === 'generate') { operation.current?.abort(); setBusy(''); }
    setConsentFor(''); setSaveConsent(false);
  }, [context]);

  const chooseTemplate = (path: string) => {
    previewSequence.current += 1; operation.current?.abort(); setBusy('');
    onTemplate(path); setPreview(null); setChunkIds([]); setFilter(''); setShown(40); setConsentFor(''); setPending(null); setError('');
  };
  const openPreview = async () => {
    const sequence = ++previewSequence.current;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    setBusy('preview'); setError(''); setConsentFor(''); setChunkIds([]);
    try {
      const data = await request<{ preview: TemplatePreview }>(`/api/work-templates?path=${encodeURIComponent(project.baseTemplatePath)}`, token, { signal: controller.signal });
      if (sequence === previewSequence.current) { setPreview(data.preview); setShown(40); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось прочитать фрагменты.'); }
    finally { if (sequence === previewSequence.current) setBusy(''); }
  };
  const generate = async () => {
    if (!preview || !consent || dirty || busy || !selected.length || !allowed || !approved || projectSaving) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy('generate'); setError(''); setNotice(''); setPending(null); setSaveConsent(false); setConsentFor('');
    try {
      const data = await request<{ draft: PprDraft }>('/api/agents/ppr-section', token, { method: 'POST', signal: controller.signal, body: JSON.stringify({ taskId: task.id, revision: task.revision, sectionId, templatePath: preview.path, textHash: preview.textHash, sourceHash: preview.sourceHash, chunkIds: selected.map(item => item.id), confirmDataTransfer: true }) });
      if (!controller.signal.aborted) { setPending(data.draft); setEditing(false); setNotice('Черновик ещё не сохранён. Проверьте текст, вопросы и отличия от шаблона.'); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось создать черновик.'); }
    finally { if (operation.current === controller) setBusy(''); }
  };
  const save = async () => {
    if (!pending || pendingStale || !saveConsent || busy || projectSaving) return;
    setBusy('save'); setError('');
    try {
      const data = await request<{ task: Task }>(`/api/tasks/${task.id}/ppr-drafts`, token, { method: 'POST', body: JSON.stringify({ revision: task.revision, confirmSave: true, draft: pending }) });
      setSavedId(pending.id); setPending(null); setSaveConsent(false); setEditing(false); onSaved(data.task); setNotice('Новая версия сохранена. Исходный шаблон не изменён.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить версию.'); }
    finally { setBusy(''); }
  };
  const download = (draft: PprDraft | SavedPprDraft) => {
    const url = URL.createObjectURL(new Blob([draftHtml(draft)], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `PPR-${draft.sectionId}-${'version' in draft ? `v${draft.version}` : 'draft'}.html`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className={`ppr-studio ${embedded ? 'studio-embedded' : ''}`} id="ppr-section-studio">
    <header><div><FilePenLine /><span><small>РАЗРАБОТЧИК ППР · РАБОТА ПО ШАБЛОНУ</small><h2>Черновик одного раздела</h2></span></div><span className="studio-badge">С проверкой перед сохранением</span></header>
    {error && <p role="alert" className="studio-message error"><TriangleAlert />{error}</p>}
    {notice && <output className="studio-message"><Check />{notice}</output>}
    <div className="studio-layout">
      <details className="studio-sources">
        <summary>Источники и создание раздела</summary>
        <h3><BookOpen />1. Выберите материал</h3>
        <label htmlFor="draft-section">Раздел ППР</label>
        <select id="draft-section" value={sectionId} disabled={!!busy} onChange={event => onSection(event.target.value)}>
          {!allowed && <option value={sectionId}>{plan.find(item => item.id === sectionId)?.title || 'Выберите текстовый раздел'}</option>}
          {plan.filter(item => draftableSectionIds.some(id => id === item.id)).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        {!allowed && <p className="studio-hint">Графика, нормативный перечень и специальные приложения не генерируются на этом этапе. Выберите текстовый раздел.</p>}
        {!library ? <p className="studio-hint">{error ? <button onClick={() => void loadTemplates()}>Повторить загрузку библиотеки</button> : 'Загружаем библиотеку…'}</p> : !library.enabled ? <p className="studio-hint">Выбор локального шаблона и генерация доступны в версии на компьютере. На Vercel можно читать и скачивать сохранённые версии.</p> : <>
          <label htmlFor="draft-template">Шаблон из локальной библиотеки</label>
          <select id="draft-template" value={project.baseTemplatePath} disabled={!!busy} onChange={event => chooseTemplate(event.target.value)}>
            <option value="">Выберите распознанный DOCX или PDF</option>
            {project.baseTemplatePath && !library.templates.some(item => item.path === project.baseTemplatePath) && <option value={project.baseTemplatePath}>Недоступен: {project.baseTemplatePath}</option>}
            {library.templates.map(item => <option key={item.path} value={item.path}>{item.path}</option>)}
          </select>
          <div className="studio-inline"><button onClick={() => void openPreview()} disabled={!!busy || !project.baseTemplatePath}>{busy === 'preview' ? <LoaderCircle className="spin" /> : <BookOpen />}Открыть фрагменты</button><button onClick={() => void loadTemplates()} disabled={!!busy}>Обновить список</button></div>
          {!library.templates.length && <p className="studio-hint">Нет распознанных шаблонов. Обновите локальный индекс.</p>}
          {preview?.path === project.baseTemplatePath && <>
            <p className="studio-hint">{preview.name} · {preview.chunks.length} фрагментов. Выберите до 8 фрагментов, не более 12 000 символов. Таблицы показаны как извлечённый текст.</p>
            <label className="studio-filter"><Search /><input aria-label="Поиск внутри шаблона" value={filter} onChange={event => { setFilter(event.target.value); setShown(40); }} placeholder="Найти нужный раздел или абзац" /></label>
            <div className="studio-chunks">{chunks.slice(0, shown).map(chunk => {
              const checked = chunkIds.includes(chunk.id);
              return <label className={checked ? 'selected' : ''} key={chunk.id}><input aria-label={`Выбрать ${chunk.id}`} type="checkbox" checked={checked} disabled={!!busy || (!checked && (chunkIds.length >= 8 || selectedCharacters + chunk.text.length > MAX_SOURCE_CHARACTERS))} onChange={event => { setChunkIds(ids => event.target.checked ? [...ids, chunk.id] : ids.filter(id => id !== chunk.id)); setConsentFor(''); }} /><span><small>{chunk.id.replace('fragment-', 'Фрагмент ')}</small>{chunk.text}</span></label>;
            })}{!chunks.length && <p>Ничего не найдено.</p>}</div>
            {chunks.length > shown && <button className="studio-more" onClick={() => setShown(count => count + 40)}>Показать ещё · осталось {chunks.length - shown}</button>}
          </>}
          <h3>2. Проверьте передачу данных</h3>
          <p className="studio-count">Выбрано {selected.length} из 8 · {selectedCharacters.toLocaleString('ru')} символов</p>
          {!!selected.length && <details className="studio-transfer"><summary>Посмотреть выбранные фрагменты целиком</summary>{selected.map(item => <p key={item.id}>{item.text}</p>)}</details>}
          <details className="studio-transfer"><summary>Какие сведения проекта будут переданы</summary><p>{task.description}</p><dl>{Object.entries({ Объект: project.objectName, Адрес: project.objectAddress, Заказчик: project.customer, Ответственный: project.responsible, 'Вид работ': project.workType, Режим: project.developmentMode === 'with_tk' ? 'С ТК' : project.developmentMode === 'without_tk' ? 'Без ТК' : 'Не выбран', Графики: project.scheduleSource, Высота: project.brief?.risks.height === 'unknown' ? 'Уточнить' : project.hasWorkAtHeight ? 'Да' : 'Нет', 'Подъёмные сооружения': project.brief?.risks.lifting === 'unknown' ? 'Уточнить' : project.hasLiftingStructures ? 'Да' : 'Нет', 'Башенный кран': project.usesTowerCrane ? 'Да' : 'Нет', Монолит: project.hasMonolithicWork ? 'Да' : 'Нет' }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Не указано'}</dd></div>)}</dl></details>
          <details className="studio-transfer"><summary>Дополнительные вводные ТЗ и подписанты</summary><pre>{JSON.stringify(briefForAgent(project), null, 2)}</pre></details>
          <details className="studio-transfer"><summary>Подтверждённые примеры правок проекта</summary><pre>{JSON.stringify(confirmedExperience(task.pprWorkspace), null, 2)}</pre></details>
          {dirty && <div className="studio-hint">Сначала сохраните ТЗ с выбранным шаблоном. <button onClick={onSaveProject} disabled={projectSaving || !!busy}>{projectSaving ? 'Сохраняем…' : 'Сохранить ТЗ'}</button></div>}
          {!approved && <p className="studio-key-note">До создания раздела утвердите актуальную редакцию ТЗ в форме выше. Сохранённые черновики доступны для просмотра.</p>}
          {!evaluatePprReadiness(project).ready && <p className="studio-hint">Для генерации нужны наименование объекта, вид работ и режим с ТК / без ТК.</p>}
          {!library.configured && <p className="studio-key-note">Для генерации на компьютере нужен OPENAI_API_KEY в локальном серверном окружении. Ключ, сохранённый на Vercel, здесь не используется. Не вводите ключ в текст задачи.</p>}
          <label className="studio-consent"><input aria-label="Разрешить передачу фрагментов в OpenAI" type="checkbox" checked={consent} disabled={!!busy || dirty || projectSaving || !approved || !selected.length || !library.configured || !allowed} onChange={event => setConsentFor(event.target.checked ? context : '')} /><span>Разрешаю передать в OpenAI только выбранные фрагменты и показанные сведения проекта для создания этого раздела. Остальные файлы, задачи и токены не передаются.</span></label>
          <button className="studio-primary" onClick={() => void generate()} disabled={!!busy || !consent || dirty || projectSaving || !approved || !library.configured || !selected.length || !allowed || !evaluatePprReadiness(project).ready}>{busy === 'generate' ? <LoaderCircle className="spin" /> : <Send />}{busy === 'generate' ? 'Готовим черновик…' : 'Создать черновик раздела'}</button>
        </>}
      </details>
      <div className="studio-review">
        <h3>3. Проверьте результат</h3>
        {!!versions.length && <label className="studio-version">Сохранённые версии<select aria-label="Сохранённая версия раздела" value={saved?.id || ''} disabled={!!busy || !!pending} onChange={event => setSavedId(event.target.value)}>{[...versions].reverse().map(item => <option key={item.id} value={item.id}>Версия {item.version} · {new Date(item.createdAt).toLocaleString('ru-RU')}</option>)}</select></label>}
        {!visible ? emptyPreview || <div className="studio-empty"><FilePenLine /><h4>Здесь появится черновик</h4><p>Новые и изменённые абзацы будут синими. Исходный шаблон останется без изменений.</p></div> : <>
          <div className="studio-result-title"><strong>{visible.sectionTitle}</strong><span>{pending ? 'Не сохранён' : `Версия ${(visible as SavedPprDraft).version}`}</span></div>
          <p className="studio-legend">Синий — новый или изменённый абзац. Тёмный — дословно взят из выбранного фрагмента. Это сравнение текста, а не разметка исходного DOCX.</p>
          {pendingStale && <p className="studio-message error">Паспорт или ревизия проекта изменились. Черновик можно скачать, но перед сохранением нужна новая генерация по актуальным данным.</p>}
          {pending && editing ? <div className="studio-edit">{pending.paragraphs.map((item, index) => <label key={index}>Абзац {index + 1}<textarea aria-label={`Текст абзаца ${index + 1}`} maxLength={3000} value={item.text} onChange={event => { const values = pending.paragraphs.map((paragraph, position) => position === index ? event.target.value : paragraph.text); setPending({ ...pending, paragraphs: markDraftParagraphs(values, pending.sources) }); setSaveConsent(false); }} /></label>)}</div> : <DraftText draft={visible} />}
          <div className="studio-inline">{pending && <button onClick={() => { setEditing(!editing); setSaveConsent(false); }} disabled={!!busy}>{editing ? 'Просмотр' : 'Править текст'}</button>}<button onClick={() => download(visible)}><Download />Скачать HTML</button></div>
          <p className="studio-hint">HTML сохраняет синий цвет и открывается в браузере. Выпуск DOCX с оформлением шаблона — следующий этап.</p>
          <details className="studio-transfer"><summary>Исходные фрагменты для сравнения</summary>{visible.sources.map(item => <p key={item.id}>{item.text}</p>)}</details>
          <div className="studio-checks"><h4>Уточнения и проверки</h4>{[...visible.questions, ...visible.warnings].map((item, index) => <p key={index}><TriangleAlert />{item}</p>)}</div>
          {pending && <div className="studio-save"><label className="studio-consent"><input aria-label="Подтвердить сохранение версии ППР" type="checkbox" checked={saveConsent} disabled={!!busy || pendingStale} onChange={event => setSaveConsent(event.target.checked)} /><span>Я проверил черновик и разрешаю сохранить его вместе с выбранными исходными фрагментами {cloud ? 'в Supabase для синхронизации проекта' : 'во временной памяти локального сервера (до перезапуска)'}. Это не утверждение ППР к производству работ.</span></label><button className="studio-primary" onClick={() => void save()} disabled={!!busy || !saveConsent || pendingStale}>{busy === 'save' ? <LoaderCircle className="spin" /> : <Save />}Сохранить новую версию</button><button onClick={() => { setPending(null); setSaveConsent(false); }} disabled={!!busy}>Отклонить черновик</button></div>}
        </>}
      </div>
    </div>
  </section>;
}
