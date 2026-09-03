'use client';
/* oxlint-disable react/react-compiler, react-compiler/effect-set-state, react-hooks/exhaustive-deps */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileText,
  FolderOpen,
  HardDrive,
  HardHat,
  LibraryBig,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { LoginScreen } from '@/components/login-screen';
import { defaultCatalog, defaultWorkChecklist, statuses, type Catalog, type Task, type WorkDocumentCategory, type WorkDocumentStatus, type WorkProject, type WorkProjectStage } from '@/lib/tasks';
import { useOrbitSession } from '@/lib/use-orbit-session';
import './workspace.css';

type DocumentKind = 'ppr' | 'tk';
type LocalFileItem = { name: string; path: string; kind: 'directory' | 'file'; extension: string; size: number | null; modifiedAt: string };
type LocalLibrary = { enabled: boolean; rootName?: string; path?: string; items: LocalFileItem[] };
type LocalIndexSummary = { total: number; indexed: number; needsConversion: number; errors: number; characters: number };
type LocalSearchResult = { name: string; path: string; extension: string; score: number; snippet: string };
type LocalSearch = { enabled: boolean; available: boolean; summary?: LocalIndexSummary; results: LocalSearchResult[] };

const projectStages: { id: WorkProjectStage; label: string }[] = [
  { id: 'source_data', label: 'Исходные данные' }, { id: 'structure', label: 'Структура' },
  { id: 'drafting', label: 'Разработка' }, { id: 'ntd_review', label: 'Проверка НТД' },
  { id: 'approval', label: 'Согласование' },
];

const documentSections: Record<DocumentKind, string[]> = {
  ppr: ['Общие данные', 'Организация работ', 'Технология производства', 'Машины и механизмы', 'Контроль качества', 'Охрана труда'],
  tk: ['Область применения', 'Организация процесса', 'Технологические операции', 'Материалы и механизмы', 'Контроль качества', 'Охрана труда'],
};

const documentCategoryLabels: Record<WorkDocumentCategory, string> = {
  source: 'Исходные данные', template: 'Шаблон', ntd: 'НТД', draft: 'Черновик', final: 'Готовый документ',
};
const documentStatusLabels: Record<WorkDocumentStatus, string> = {
  expected: 'Ожидается', available: 'Получен', review: 'На проверке', approved: 'Проверен',
};

const professionalAgents = [
  { name: 'Разработчик ППР', description: 'Собирает разделы ППР по шаблону', icon: HardHat, state: 'Следующий этап' },
  { name: 'Разработчик ТК', description: 'Готовит технологическую карту', icon: FileText, state: 'Следующий этап' },
  { name: 'Специалист по НТД', description: 'Проверяет требования по вашей базе', icon: LibraryBig, state: 'Ждёт базу НТД' },
  { name: 'Контролёр качества', description: 'Ищет пропуски и противоречия', icon: ClipboardCheck, state: 'Следующий этап' },
];

async function api<T>(path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Orbit-Client', 'dashboard');
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...options, cache: 'no-store', headers });
  const value = await response.json() as { error?: string };
  if (!response.ok) throw new Error(value.error || 'Не удалось загрузить данные.');
  return value as T;
}

function taskKind(task: Task): DocumentKind {
  return /(^|\s)тк([\s.,]|$)|технологическ/i.test(task.title) ? 'tk' : 'ppr';
}

function dateLabel(value: string | null) {
  if (!value) return 'Срок не задан';
  return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function taskProgress(task: Task) {
  if (task.status === 'completed') return 100;
  if (!task.subtasks?.length) return 0;
  return Math.round(task.subtasks.filter(item => item.completed).length / task.subtasks.length * 100);
}

function fileSize(value: number | null) {
  if (value === null) return '';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

function initialProject(task: Task): WorkProject {
  return task.workProject || { documentType: taskKind(task), objectName: task.title, objectAddress: '', customer: '', responsible: '', stage: 'source_data', documents: [], checklist: defaultWorkChecklist() };
}

export default function WorkWorkspace() {
  const access = useOrbitSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [catalog, setCatalog] = useState<Catalog>(defaultCatalog);
  const [selectedId, setSelectedId] = useState('');
  const [kind, setKind] = useState<DocumentKind>('ppr');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [projectDraft, setProjectDraft] = useState<WorkProject | null>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [documentCategory, setDocumentCategory] = useState<WorkDocumentCategory>('source');
  const [checklistTitle, setChecklistTitle] = useState('');
  const [library, setLibrary] = useState<LocalLibrary>({ enabled: false, items: [] });
  const [libraryChecked, setLibraryChecked] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [librarySearch, setLibrarySearch] = useState<LocalSearch>({ enabled: false, available: false, results: [] });
  const [librarySearchChecked, setLibrarySearchChecked] = useState(false);
  const [librarySearching, setLibrarySearching] = useState(false);
  const [librarySearchApplied, setLibrarySearchApplied] = useState('');

  const load = async () => {
    if (access.loading || (access.mode === 'supabase' && !access.accessToken)) return;
    setLoading(true);
    setError('');
    try {
      const [taskData, catalogData] = await Promise.all([
        api<{ tasks: Task[] }>('/api/tasks', access.accessToken),
        api<{ catalog: Catalog }>('/api/catalog', access.accessToken),
      ]);
      setTasks(taskData.tasks);
      setCatalog(catalogData.catalog);
      const pprDirection = catalogData.catalog.directions.find(item => item.sphereId === 'work' && item.name.trim().toLocaleLowerCase('ru') === 'ппр');
      const workTasks = taskData.tasks.filter(task => task.sphere === 'work' && task.directionId === pprDirection?.id);
      setSelectedId(current => workTasks.some(task => task.id === current) ? current : workTasks[0]?.id || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Нет соединения с сервером.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { queueMicrotask(() => void load()); }, [access.loading, access.mode, access.accessToken]);

  const loadLibrary = async (path = '') => {
    if (access.loading || (access.mode === 'supabase' && !access.accessToken)) return;
    setLibraryLoading(true);
    try {
      const data = await api<LocalLibrary>(`/api/work-files?path=${encodeURIComponent(path)}`, access.accessToken);
      setLibrary(data); setLibraryChecked(true);
    } catch (cause) {
      setLibraryChecked(true); setError(cause instanceof Error ? cause.message : 'Не удалось открыть локальную библиотеку.');
    } finally { setLibraryLoading(false); }
  };

  const searchLibrary = async (searchQuery = '') => {
    if (access.loading || (access.mode === 'supabase' && !access.accessToken)) return;
    const cleaned = searchQuery.trim();
    setLibrarySearching(true);
    try {
      const data = await api<LocalSearch>(`/api/work-search?q=${encodeURIComponent(cleaned)}`, access.accessToken);
      setLibrarySearch(data); setLibrarySearchApplied(cleaned); setLibrarySearchChecked(true);
    } catch (cause) {
      setLibrarySearchChecked(true); setError(cause instanceof Error ? cause.message : 'Не удалось выполнить поиск по библиотеке.');
    } finally { setLibrarySearching(false); }
  };

  useEffect(() => {
    if (!access.loading) queueMicrotask(() => { void loadLibrary(); void searchLibrary(); });
  }, [access.loading, access.mode, access.accessToken]);

  const pprDirection = catalog.directions.find(item => item.sphereId === 'work' && item.name.trim().toLocaleLowerCase('ru') === 'ппр');
  const workTasks = useMemo(() => tasks
    .filter(task => task.sphere === 'work' && task.directionId === pprDirection?.id)
    .filter(task => !query.trim() || task.title.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
    .sort((a, b) => Number(b.focus) - Number(a.focus) || (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31')),
  [tasks, query, pprDirection?.id]);
  const selected = tasks.find(task => task.id === selectedId && task.sphere === 'work' && task.directionId === pprDirection?.id) || workTasks[0];
  const selectedDirection = selected ? catalog.directions.find(item => item.id === selected.directionId)?.name : '';
  const progress = selected ? taskProgress(selected) : 0;
  const sections = documentSections[kind];
  const checklistDone = projectDraft?.checklist.filter(item => item.completed).length || 0;
  const librarySegments = (library.path || '').split('/').filter(Boolean);

  useEffect(() => { if (selected) { const project = initialProject(selected); setProjectDraft(project); setKind(project.documentType); } else setProjectDraft(null); }, [selected?.id, selected?.revision]);

  const saveProject = async () => {
    if (!selected || !projectDraft || projectSaving) return;
    setProjectSaving(true); setError(''); setNotice('');
    try {
      const data = await api<{ task: Task }>(`/api/tasks/${selected.id}`, access.accessToken, { method: 'PATCH', body: JSON.stringify({ op: 'edit_work_project', revision: selected.revision, project: projectDraft }) });
      setTasks(current => current.map(task => task.id === data.task.id ? data.task : task));
      setNotice('Карточка проекта сохранена.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить карточку проекта.'); }
    finally { setProjectSaving(false); }
  };

  const addDocument = () => {
    if (!projectDraft || !documentName.trim() || projectDraft.documents.length >= 100) return;
    setProjectDraft({ ...projectDraft, documents: [...projectDraft.documents, { id: crypto.randomUUID(), name: documentName.trim(), category: documentCategory, version: '1.0', status: 'expected', updatedAt: new Date().toISOString() }] });
    setDocumentName('');
  };

  const addChecklistItem = () => {
    if (!projectDraft || !checklistTitle.trim() || projectDraft.checklist.length >= 60) return;
    setProjectDraft({ ...projectDraft, checklist: [...projectDraft.checklist, { id: crypto.randomUUID(), title: checklistTitle.trim(), completed: false }] });
    setChecklistTitle('');
  };

  const downloadLocalFile = async (item: Pick<LocalFileItem, 'name' | 'path'>) => {
    setError('');
    try {
      const headers = new Headers({ 'X-Orbit-Client': 'dashboard' });
      if (access.accessToken) headers.set('Authorization', `Bearer ${access.accessToken}`);
      const response = await fetch(`/api/work-files/download?path=${encodeURIComponent(item.path)}`, { headers, cache: 'no-store' });
      if (!response.ok) { const value = await response.json() as { error?: string }; throw new Error(value.error || 'Не удалось скачать файл.'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = item.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось скачать файл.'); }
  };

  if (access.loading) return <main className="work-auth"><LoaderCircle className="spin" />Загружаем рабочее пространство…</main>;
  if (access.error || (access.mode === 'supabase' && !access.accessToken)) return <LoginScreen onSignIn={access.signIn} onSignUp={access.signUp} setupError={access.error} />;

  return <main className="work-app">
    <header className="work-topbar">
      <div className="work-brand"><span><HardHat /></span><div><strong>ORBIT WORKS</strong><small>разработка ППР и ТК</small></div></div>
      <nav className="work-mode" aria-label="Режим документа">
        <button className={kind === 'ppr' ? 'active' : ''} onClick={() => { setKind('ppr'); setProjectDraft(current => current ? { ...current, documentType: 'ppr' } : current); }}>ППР</button>
        <button className={kind === 'tk' ? 'active' : ''} onClick={() => { setKind('tk'); setProjectDraft(current => current ? { ...current, documentType: 'tk' } : current); }}>ТК</button>
      </nav>
      <div className="work-top-actions"><button className="work-icon-button" aria-label="Обновить проекты" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /></button><Link href="/" className="work-back"><ArrowLeft />К задачам</Link></div>
    </header>

    {error && <div className="work-feedback"><CircleAlert />{error}</div>}
    {notice && <div className="work-feedback work-success"><Check />{notice}</div>}

    <div className="work-shell">
      <aside className="work-sidebar">
        <div className="side-heading"><span>РАБОЧИЕ ПРОЕКТЫ</span><b>{workTasks.length}</b></div>
        <label className="work-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти проект" /></label>
        <div className="project-list">
          {workTasks.map(task => <button key={task.id} className={task.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(task.id)}>
            <span className="project-file"><FileText /></span><span><strong>{task.title}</strong><small>{catalog.directions.find(item => item.id === task.directionId)?.name || 'Без направления'}</small></span><ChevronRight />
          </button>)}
          {!loading && !workTasks.length && <div className="side-empty"><FolderOpen /><span>Назначьте рабочей задаче направление «ППР» — после этого она появится здесь.</span></div>}
        </div>
        <Link href="/" className="new-work-task"><Plus />Добавить рабочую задачу</Link>
        <div className="side-heading agent-heading"><span>ПРОФЕССИОНАЛЬНЫЕ АГЕНТЫ</span></div>
        <div className="work-agents">{professionalAgents.map(agent => { const Icon = agent.icon; return <button key={agent.name} disabled><span><Icon /></span><span><strong>{agent.name}</strong><small>{agent.description}</small></span><em>{agent.state}</em></button>; })}</div>
      </aside>

      <section className="work-content">
        {!selected ? <div className="work-empty"><FolderOpen /><h1>Проектов ППР пока нет</h1><p>В основном дашборде выберите для рабочей задачи направление «ППР».</p><Link href="/">Перейти к задачам</Link></div> : <>
          <header className="project-header">
            <div><span className="project-kicker">{kind === 'ppr' ? 'ПРОЕКТ ПРОИЗВОДСТВА РАБОТ' : 'ТЕХНОЛОГИЧЕСКАЯ КАРТА'}</span><h1>{selected.title}</h1><p>{selectedDirection || 'Без направления'} · {statuses[selected.status]} · {selected.dueDate ? `до ${dateLabel(selected.dueDate)}` : 'срок не задан'}</p></div>
            <div className="project-progress"><span><b>{progress}%</b> прогресс задачи</span><i><b style={{ width: `${progress}%` }} /></i></div>
          </header>

          {projectDraft && <section className="project-card">
            <header><div><span>КАРТОЧКА ПРОЕКТА</span><h2>Основные данные</h2></div><small>Сохраняется вместе с задачей Orbit</small></header>
            <div className="project-fields">
              <label><span>Вид документа</span><select value={projectDraft.documentType} onChange={event => { const documentType = event.target.value as DocumentKind; setProjectDraft({ ...projectDraft, documentType }); setKind(documentType); }}><option value="ppr">ППР</option><option value="tk">ТК</option></select></label>
              <label className="project-field-wide"><span>Объект</span><input value={projectDraft.objectName} maxLength={240} onChange={event => setProjectDraft({ ...projectDraft, objectName: event.target.value })} placeholder="Название объекта" /></label>
              <label className="project-field-wide"><span>Адрес объекта</span><input value={projectDraft.objectAddress} maxLength={300} onChange={event => setProjectDraft({ ...projectDraft, objectAddress: event.target.value })} placeholder="Адрес пока не указан" /></label>
              <label><span>Заказчик</span><input value={projectDraft.customer} maxLength={200} onChange={event => setProjectDraft({ ...projectDraft, customer: event.target.value })} placeholder="Организация" /></label>
              <label><span>Ответственный</span><input value={projectDraft.responsible} maxLength={160} onChange={event => setProjectDraft({ ...projectDraft, responsible: event.target.value })} placeholder="ФИО" /></label>
              <label><span>Текущий этап</span><select value={projectDraft.stage} onChange={event => setProjectDraft({ ...projectDraft, stage: event.target.value as WorkProjectStage })}>{projectStages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
              <button className="save-project" disabled={projectSaving} onClick={() => void saveProject()}>{projectSaving ? <LoaderCircle className="spin" /> : <Save />}{projectSaving ? 'Сохраняем…' : 'Сохранить карточку'}</button>
            </div>
          </section>}

          <div className="workflow-strip">
            {projectStages.map((step, index) => { const currentIndex = projectStages.findIndex(item => item.id === projectDraft?.stage); return <div className={index === currentIndex ? 'current' : index < currentIndex ? 'complete' : ''} key={step.id}><span>{index < currentIndex ? <Check /> : index + 1}</span><b>{step.label}</b></div>; })}
          </div>

          <div className="work-grid">
            <section className="work-panel structure-panel">
              <header><div><span>СТРУКТУРА</span><h2>{kind === 'ppr' ? 'Разделы ППР' : 'Разделы ТК'}</h2></div><ListChecks /></header>
              <div className="section-list">{sections.map((section, index) => <button key={section} className={index === 0 ? 'active' : ''}><span>{index + 1}</span><b>{section}</b><ChevronRight /></button>)}</div>
              <div className="task-stages"><span>ЭТАПЫ ИЗ ЗАДАЧИ</span>{selected.subtasks?.length ? selected.subtasks.map(item => <div key={item.id} className={item.completed ? 'done' : ''}><i>{item.completed && <Check />}</i><span><b>{item.title}</b><small>{dateLabel(item.dueDate)}{item.dueTime ? `, ${item.dueTime}` : ''}</small></span></div>) : <p>Этапы ещё не добавлены.</p>}</div>
            </section>

            <section className="work-panel editor-panel">
              <header><div><span>РАБОЧИЙ ДОКУМЕНТ</span><h2>{sections[0]}</h2></div><em>Черновик не создан</em></header>
              <article className="document-sheet">
                <div className="sheet-mark"><HardHat /></div>
                <span>{kind === 'ppr' ? 'ППР' : 'ТК'}</span>
                <h2>{selected.title}</h2>
                <div className="sheet-rule" />
                <h3>{sections[0]}</h3>
                <p>{selected.description}</p>
                <div className="sheet-placeholder"><Sparkles /><span><b>Здесь появится текст документа</b><small>После подключения шаблона и агента-разработчика.</small></span></div>
              </article>
              <footer><span>Содержимое задачи уже синхронизировано с Orbit.</span><button disabled><Sparkles />Сформировать раздел</button></footer>
            </section>

            <aside className="work-side-column">
              <section className="work-panel files-panel">
                <header><div><span>ДОКУМЕНТЫ ПРОЕКТА</span><h2>Реестр файлов</h2></div><Upload /></header>
                <div className="document-register">
                  {projectDraft?.documents.length ? <div className="document-items">{projectDraft.documents.map(document => <article key={document.id}>
                    <FileText />
                    <div><b>{document.name}</b><span className="document-meta"><select aria-label={`Категория ${document.name}`} value={document.category} onChange={event => setProjectDraft({ ...projectDraft, documents: projectDraft.documents.map(item => item.id === document.id ? { ...item, category: event.target.value as WorkDocumentCategory, updatedAt: new Date().toISOString() } : item) })}>{Object.entries(documentCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input aria-label={`Версия ${document.name}`} value={document.version} maxLength={40} onChange={event => setProjectDraft({ ...projectDraft, documents: projectDraft.documents.map(item => item.id === document.id ? { ...item, version: event.target.value, updatedAt: new Date().toISOString() } : item) })} placeholder="Версия" /></span></div>
                    <select aria-label={`Статус ${document.name}`} value={document.status} onChange={event => setProjectDraft({ ...projectDraft, documents: projectDraft.documents.map(item => item.id === document.id ? { ...item, status: event.target.value as WorkDocumentStatus, updatedAt: new Date().toISOString() } : item) })}>{Object.entries(documentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    <button aria-label={`Удалить ${document.name}`} onClick={() => setProjectDraft({ ...projectDraft, documents: projectDraft.documents.filter(item => item.id !== document.id) })}><Trash2 /></button>
                  </article>)}</div> : <div className="register-empty"><FolderOpen /><b>Реестр пока пуст</b><p>Добавьте названия ожидаемых или уже полученных документов.</p></div>}
                  <div className="register-add"><input value={documentName} maxLength={180} onChange={event => setDocumentName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addDocument(); } }} placeholder="Например: рабочая документация" /><select value={documentCategory} onChange={event => setDocumentCategory(event.target.value as WorkDocumentCategory)}>{Object.entries(documentCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button onClick={addDocument} disabled={!documentName.trim()}><Plus />Добавить</button></div>
                  <p className="storage-note"><Upload />Сейчас сохраняются данные о документе. Загрузка самого файла появится после выбора хранилища.</p>
                </div>
              </section>
              <section className="work-panel checklist-panel">
                <header><div><span>ГОТОВНОСТЬ ПРОЕКТА</span><h2>Чек-лист</h2></div><ClipboardCheck /></header>
                <div className="project-checklist">{projectDraft?.checklist.map(item => <div key={item.id} className={item.completed ? 'done' : ''}><button aria-label={item.completed ? `Вернуть ${item.title}` : `Выполнить ${item.title}`} onClick={() => setProjectDraft({ ...projectDraft, checklist: projectDraft.checklist.map(check => check.id === item.id ? { ...check, completed: !check.completed } : check) })}>{item.completed && <Check />}</button><span>{item.title}</span><button aria-label={`Удалить ${item.title}`} onClick={() => setProjectDraft({ ...projectDraft, checklist: projectDraft.checklist.filter(check => check.id !== item.id) })}><Trash2 /></button></div>)}</div>
                <div className="checklist-add"><input value={checklistTitle} maxLength={180} onChange={event => setChecklistTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addChecklistItem(); } }} placeholder="Добавить пункт проверки" /><button onClick={addChecklistItem} disabled={!checklistTitle.trim()}><Plus /></button></div>
              </section>
              <section className="work-panel ntd-panel"><header><div><span>НОРМАТИВНЫЙ КОНТРОЛЬ</span><h2>Специалист по НТД</h2></div><LibraryBig /></header><div className="agent-status"><i /><span><b>Подготовлен интерфейс</b><small>Агент начнёт проверку после подключения вашей базы НТД.</small></span></div><button disabled><ShieldCheck />Проверить раздел</button></section>
            </aside>
          </div>

          <section className="local-library">
            <header><div><span><HardDrive /></span><div><small>ЛОКАЛЬНЫЕ МАТЕРИАЛЫ</small><h2>Библиотека шаблонов ППР и ТК</h2></div></div>{library.enabled && <em>Только на этом компьютере</em>}</header>
            {!libraryChecked || libraryLoading ? <div className="library-state"><LoaderCircle className="spin" />Читаем локальную папку…</div> : !library.enabled ? <div className="library-state"><HardDrive /><div><b>Локальная библиотека выключена</b><p>На сайте Vercel файлы с диска компьютера недоступны. Запустите локальную версию Orbit.</p></div></div> : <>
              <nav className="library-path"><button onClick={() => void loadLibrary('')}><HardDrive />{library.rootName}</button>{librarySegments.map((segment, index) => <button key={`${segment}-${index}`} onClick={() => void loadLibrary(librarySegments.slice(0, index + 1).join('/'))}><ChevronRight />{segment}</button>)}</nav>
              <div className="library-search-box">
                <form onSubmit={event => { event.preventDefault(); void searchLibrary(libraryQuery); }}>
                  <Search /><input value={libraryQuery} maxLength={120} onChange={event => setLibraryQuery(event.target.value)} placeholder="Найти технологию, раздел или требование в шаблонах" />
                  {librarySearchApplied && <button type="button" className="clear-library-search" onClick={() => { setLibraryQuery(''); void searchLibrary(''); }} aria-label="Очистить поиск"><X /></button>}
                  <button type="submit" disabled={librarySearching || libraryQuery.trim().length < 2}>{librarySearching ? <LoaderCircle className="spin" /> : <Search />}Найти</button>
                </form>
                {librarySearchChecked && librarySearch.available && librarySearch.summary && <p><b>{librarySearch.summary.indexed}</b> файлов распознано · {librarySearch.summary.needsConversion} старых DOC требуют преобразования{librarySearch.summary.errors ? ` · ${librarySearch.summary.errors} файла требуют повторной обработки` : ''}</p>}
                {librarySearchChecked && !librarySearch.available && <p>Индекс пока не создан. Папки и файлы доступны для просмотра вручную.</p>}
              </div>
              {librarySearchApplied ? <div className="library-results">
                <div className="library-result-heading"><span>РЕЗУЛЬТАТЫ ПОИСКА</span><b>{librarySearch.results.length}</b></div>
                {librarySearch.results.length ? librarySearch.results.map(item => <article key={item.path}>
                  <FileText /><span><b>{item.name}</b><p>{item.snippet}</p><small>{item.path}</small></span><button onClick={() => void downloadLocalFile(item)} aria-label={`Скачать ${item.name}`}><Download /></button>
                </article>) : <div className="library-no-results"><Search /><b>В распознанных шаблонах ничего не найдено</b><p>Попробуйте более короткий запрос или откройте папки вручную.</p></div>}
              </div> : <div className="library-items">{library.items.map(item => item.kind === 'directory' ? <button key={item.path} className="library-folder" onClick={() => void loadLibrary(item.path)}><FolderOpen /><span><b>{item.name}</b><small>Папка</small></span><ChevronRight /></button> : <article key={item.path}><FileText /><span><b>{item.name}</b><small>{item.extension.toLocaleUpperCase()} · {fileSize(item.size)} · {new Date(item.modifiedAt).toLocaleDateString('ru-RU')}</small></span><button onClick={() => void downloadLocalFile(item)} aria-label={`Скачать ${item.name}`}><Download /></button></article>)}</div>}
            </>}
          </section>

          <section className="quality-bar"><div><FileCheck2 /><span><b>Контроль документа</b><small>Реестр и чек-лист сохраняются вместе с карточкой проекта.</small></span></div><dl><div><dt>Документы</dt><dd>{projectDraft?.documents.length || 0}</dd></div><div><dt>Чек-лист</dt><dd>{checklistDone} / {projectDraft?.checklist.length || 0}</dd></div><div><dt>Разделы</dt><dd>0 / {sections.length}</dd></div></dl><button disabled><Scale />Передать на проверку</button></section>
        </>}
      </section>
    </div>
  </main>;
}
