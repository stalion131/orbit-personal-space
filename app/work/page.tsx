'use client';
/* oxlint-disable react/react-compiler, react-compiler/effect-set-state, react-hooks/exhaustive-deps */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheckBig,
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
  Send,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { LoginScreen } from '@/components/login-screen';
import { DraftText, PprSectionStudio } from '@/components/ppr-section-studio';
import { draftableSectionIds } from '@/lib/ppr-drafts';
import type { PprDeveloperResult } from '@/lib/ppr-agent-types';
import { buildPprSectionPlan, evaluatePprReadiness, pprModeLabels, pprScheduleLabels } from '@/lib/ppr-methodology';
import { defaultCatalog, defaultWorkChecklist, statuses, type Catalog, type PprDevelopmentMode, type PprScheduleSource, type Task, type WorkDocumentCategory, type WorkDocumentStatus, type WorkProject, type WorkProjectStage } from '@/lib/tasks';
import { useOrbitSession } from '@/lib/use-orbit-session';
import './workspace.css';
import './ppr-studio.css';

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
const pprHandoffLabels = {
  ntd_specialist: 'Специалист по НТД', quality_controller: 'Контролёр качества',
  autocad_specialist: 'Специалист AutoCAD', contractor: 'Подрядчик / владелец проекта',
} as const;

const professionalAgents = [
  { name: 'Разработчик ППР', description: 'Проверяет исходные данные и строит карту ППР', icon: HardHat, state: 'Контракт MVP готов' },
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
  return task.workProject || {
    documentType: taskKind(task), objectName: task.title, objectAddress: '', customer: '', responsible: '', stage: 'source_data',
    developmentMode: 'undecided', workType: '', baseTemplatePath: '', scheduleSource: 'unknown',
    hasWorkAtHeight: false, hasLiftingStructures: false, usesTowerCrane: false, hasMonolithicWork: false,
    documents: [], checklist: defaultWorkChecklist(),
  };
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
  const [pprAgentConsent, setPprAgentConsent] = useState(false);
  const [pprAgentRunning, setPprAgentRunning] = useState(false);
  const [pprAgentResult, setPprAgentResult] = useState<PprDeveloperResult | null>(null);
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(0);

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
  const pprSectionPlan = projectDraft ? buildPprSectionPlan(projectDraft) : [];
  const pprReadiness = projectDraft ? evaluatePprReadiness(projectDraft) : null;
  const sections = kind === 'ppr' && pprSectionPlan.length ? pprSectionPlan.map(section => section.title) : documentSections[kind];
  const sectionIndex = Math.min(selectedSectionIndex, sections.length - 1);
  const activePlan = kind === 'ppr' ? pprSectionPlan[sectionIndex] : null;
  const activeDraft = selected?.pprDrafts?.filter(item => item.sectionId === activePlan?.id).at(-1);
  const checklistDone = projectDraft?.checklist.filter(item => item.completed).length || 0;
  const librarySegments = (library.path || '').split('/').filter(Boolean);

  useEffect(() => { setSelectedSectionIndex(0); }, [selected?.id, kind]);

  useEffect(() => {
    if (selected) { const project = initialProject(selected); setProjectDraft(project); setKind(project.documentType); }
    else setProjectDraft(null);
    setPprAgentConsent(false); setPprAgentResult(null);
  }, [selected?.id, selected?.revision]);

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

  const runPprAgent = async () => {
    if (!selected || !projectDraft || projectDraft.documentType !== 'ppr' || !pprAgentConsent || pprAgentRunning) return;
    setPprAgentRunning(true); setError(''); setNotice(''); setPprAgentResult(null);
    try {
      const saved = await api<{ task: Task }>(`/api/tasks/${selected.id}`, access.accessToken, { method: 'PATCH', body: JSON.stringify({ op: 'edit_work_project', revision: selected.revision, project: projectDraft }) });
      setTasks(current => current.map(task => task.id === saved.task.id ? saved.task : task));
      const analysis = await api<{ result: PprDeveloperResult }>('/api/agents/ppr-developer', access.accessToken, { method: 'POST', body: JSON.stringify({ taskId: saved.task.id, confirmDataTransfer: true }) });
      setPprAgentResult(analysis.result); setNotice('Разработчик ППР подготовил карту проекта. Проверьте результат.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось запустить разработчика ППР.'); }
    finally { setPprAgentRunning(false); }
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
        <div className="work-agents">{professionalAgents.map(agent => { const Icon = agent.icon; const available = agent.name === 'Разработчик ППР'; return <button key={agent.name} disabled={!available} className={available ? 'available' : ''} onClick={() => document.getElementById('ppr-agent')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><span><Icon /></span><span><strong>{agent.name}</strong><small>{agent.description}</small></span><em>{agent.state}</em></button>; })}</div>
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

          {projectDraft && kind === 'ppr' && pprReadiness && <section className="ppr-brief-card">
            <header><div><span><HardHat /></span><div><small>ПАСПОРТ РАЗРАБОТКИ</small><h2>Условия и состав ППР</h2></div></div><em className={pprReadiness.ready ? 'ready' : ''}>{pprReadiness.score}% исходных данных</em></header>
            <div className="ppr-brief-layout">
              <div className="ppr-brief-fields">
                <label><span>Режим разработки</span><select value={projectDraft.developmentMode} onChange={event => setProjectDraft({ ...projectDraft, developmentMode: event.target.value as PprDevelopmentMode })}>{Object.entries(pprModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label><span>Основной вид работ</span><input value={projectDraft.workType} maxLength={300} onChange={event => setProjectDraft({ ...projectDraft, workType: event.target.value })} placeholder="Например: монолитные работы" /></label>
                <label><span>Источник графиков</span><select value={projectDraft.scheduleSource} onChange={event => setProjectDraft({ ...projectDraft, scheduleSource: event.target.value as PprScheduleSource })}>{Object.entries(pprScheduleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="ppr-template-field"><span>Базовый шаблон · выберите ниже в блоке «Черновик одного раздела»</span><input value={projectDraft.baseTemplatePath} readOnly placeholder="Шаблон пока не выбран" onClick={() => document.getElementById('ppr-section-studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} /></label>
                <div className="ppr-condition-grid">
                  <label><input type="checkbox" checked={projectDraft.hasWorkAtHeight} onChange={event => setProjectDraft({ ...projectDraft, hasWorkAtHeight: event.target.checked })} /><span>Работы на высоте</span></label>
                  <label><input type="checkbox" checked={projectDraft.hasLiftingStructures} onChange={event => setProjectDraft({ ...projectDraft, hasLiftingStructures: event.target.checked, usesTowerCrane: event.target.checked ? projectDraft.usesTowerCrane : false })} /><span>Подъёмные сооружения</span></label>
                  <label><input type="checkbox" checked={projectDraft.usesTowerCrane} onChange={event => setProjectDraft({ ...projectDraft, usesTowerCrane: event.target.checked, hasLiftingStructures: event.target.checked || projectDraft.hasLiftingStructures })} /><span>Башенный кран</span></label>
                  <label><input type="checkbox" checked={projectDraft.hasMonolithicWork} onChange={event => setProjectDraft({ ...projectDraft, hasMonolithicWork: event.target.checked })} /><span>Монолитные работы</span></label>
                </div>
              </div>
              <aside className="ppr-readiness">
                <div className="readiness-score"><strong>{pprReadiness.score}%</strong><span>{pprReadiness.ready ? 'можно начинать' : 'нужно уточнить данные'}</span></div>
                {pprReadiness.missing.length > 0 && <div><b><CircleAlert />Блокирует запуск</b>{pprReadiness.missing.map(item => <p key={item}>{item}</p>)}</div>}
                {pprReadiness.warnings.length > 0 && <div><b><TriangleAlert />Проверьте до выпуска</b>{pprReadiness.warnings.slice(0, 4).map(item => <p key={item}>{item}</p>)}</div>}
                {pprReadiness.ready && !pprReadiness.warnings.length && <div className="readiness-complete"><CircleCheckBig /><span><b>Паспорт заполнен</b><p>Можно передавать проект агенту.</p></span></div>}
              </aside>
            </div>
          </section>}

          <div className="workflow-strip">
            {projectStages.map((step, index) => { const currentIndex = projectStages.findIndex(item => item.id === projectDraft?.stage); return <div className={index === currentIndex ? 'current' : index < currentIndex ? 'complete' : ''} key={step.id}><span>{index < currentIndex ? <Check /> : index + 1}</span><b>{step.label}</b></div>; })}
          </div>

          <div className="work-grid">
            <section className="work-panel structure-panel">
              <header><div><span>СТРУКТУРА</span><h2>{kind === 'ppr' ? 'Разделы ППР' : 'Разделы ТК'}</h2></div><ListChecks /></header>
              <div className="section-list">{sections.map((section, index) => { const planItem = kind === 'ppr' ? pprSectionPlan[index] : null; return <button key={planItem?.id || section} className={index === sectionIndex ? 'active' : ''} title={planItem?.note} onClick={() => setSelectedSectionIndex(index)}><span>{index + 1}</span><b>{section.replace(/^\d+\.\s*/, '')}{planItem && <small>{planItem.treatment === 'manual' ? 'Вручную' : planItem.treatment === 'reference' ? 'Ссылка' : planItem.treatment === 'expand' ? 'Раскрыть' : planItem.treatment === 'conditional' ? 'По условию' : 'Постоянный'}</small>}</b><ChevronRight /></button>; })}</div>
              <div className="task-stages"><span>ЭТАПЫ ИЗ ЗАДАЧИ</span>{selected.subtasks?.length ? selected.subtasks.map(item => <div key={item.id} className={item.completed ? 'done' : ''}><i>{item.completed && <Check />}</i><span><b>{item.title}</b><small>{dateLabel(item.dueDate)}{item.dueTime ? `, ${item.dueTime}` : ''}</small></span></div>) : <p>Этапы ещё не добавлены.</p>}</div>
            </section>

            <section className="work-panel editor-panel">
              <header><div><span>РАБОЧИЙ ДОКУМЕНТ</span><h2>{sections[sectionIndex]}</h2></div><em>{activeDraft ? `Черновик · версия ${activeDraft.version}` : 'Черновик не создан'}</em></header>
              <article className="document-sheet">
                <div className="sheet-mark"><HardHat /></div>
                <span>{kind === 'ppr' ? 'ППР' : 'ТК'}</span>
                <h2>{selected.title}</h2>
                <div className="sheet-rule" />
                <h3>{sections[sectionIndex]}</h3>
                {activeDraft ? <DraftText draft={activeDraft} /> : <><p>{selected.description}</p><div className="sheet-placeholder"><Sparkles /><span><b>Здесь появится текст документа</b><small>{activePlan?.note || 'Генерация ТК будет подключена отдельным этапом.'}</small></span></div></>}
              </article>
              <footer><span>{activeDraft ? 'Черновик требует инженерной проверки.' : 'Содержимое задачи синхронизировано с Orbit.'}</span><button disabled={kind !== 'ppr' || !draftableSectionIds.some(id => id === activePlan?.id)} onClick={() => document.getElementById('ppr-section-studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Sparkles />Работа с шаблоном</button></footer>
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

          {projectDraft && kind === 'ppr' && pprReadiness && <section className="ppr-agent-panel" id="ppr-agent">
            <header><div><span><Bot /></span><div><small>ПРОФЕССИОНАЛЬНЫЙ АГЕНТ</small><h2>Разработчик ППР</h2></div></div><em>{pprAgentResult ? 'Анализ готов' : 'Контракт MVP'}</em></header>
            <div className="ppr-agent-intro">
              <div><h3>Что он делает сейчас</h3><p>Проверяет один выбранный проект, формирует карту разделов и вопросы по недостающим исходным данным. НТД, AutoCAD и контроль качества остаются отдельными ролями.</p></div>
              <dl><div><dt>Разделов в карте</dt><dd>{pprSectionPlan.length}</dd></div><div><dt>Готовность</dt><dd>{pprReadiness.score}%</dd></div><div><dt>Режим</dt><dd>{projectDraft.developmentMode === 'with_tk' ? 'с ТК' : projectDraft.developmentMode === 'without_tk' ? 'без ТК' : 'не выбран'}</dd></div></dl>
            </div>
            <div className="ppr-agent-control">
              <label aria-label="Разрешить анализ выбранного проекта"><input type="checkbox" checked={pprAgentConsent} onChange={event => setPprAgentConsent(event.target.checked)} /><span><b>Разрешаю анализ выбранного проекта</b><small>В OpenAI будут переданы описание этой задачи, паспорт ППР и названия записей реестра. Остальные задачи, файлы, email и локальная библиотека не передаются.</small></span></label>
              <button onClick={() => void runPprAgent()} disabled={!pprAgentConsent || pprAgentRunning}>{pprAgentRunning ? <LoaderCircle className="spin" /> : <Send />}{pprAgentRunning ? 'Анализируем…' : 'Составить карту ППР'}</button>
            </div>
            {pprAgentResult && <div className="ppr-agent-result">
              <div className="agent-result-summary"><span className={pprAgentResult.readiness === 'ready' ? 'ready' : ''}>{pprAgentResult.readiness === 'ready' ? <CircleCheckBig /> : <CircleAlert />}</span><div><b>{pprAgentResult.readiness === 'ready' ? 'Можно начинать разработку' : 'Сначала нужны уточнения'}</b><p>{pprAgentResult.overview}</p></div></div>
              <div className="agent-result-grid">
                <section className="agent-plan-sections"><h3>Карта разделов ППР</h3><div>{pprAgentResult.sections.map((item, index) => <article key={`${item.title}-${index}`}><span>{index + 1}</span><div><b>{item.title}</b><p>{item.rationale}</p></div><em>{item.treatment === 'manual' ? 'Вручную' : item.treatment === 'reference' ? 'Ссылка' : item.treatment === 'expand' ? 'Раскрыть' : item.treatment === 'conditional' ? 'По условию' : 'Оставить'}</em></article>)}</div></section>
                <section><h3>Недостающие данные и вопросы</h3>{[...pprAgentResult.missingInformation, ...pprAgentResult.questions].filter((item, index, all) => all.indexOf(item) === index).length ? [...pprAgentResult.missingInformation, ...pprAgentResult.questions].filter((item, index, all) => all.indexOf(item) === index).map((item, index) => <p key={`${item}-${index}`}><span>{index + 1}</span>{item}</p>) : <p className="agent-result-empty">Дополнительных вопросов нет.</p>}</section>
                <section><h3>Передать другим ролям</h3>{pprAgentResult.handoffs.length ? pprAgentResult.handoffs.map((item, index) => <p key={`${item.target}-${index}`}><b>{pprHandoffLabels[item.target]}</b>{item.reason}</p>) : <p className="agent-result-empty">Передача другим ролям пока не требуется.</p>}</section>
                <section><h3>Предупреждения</h3>{pprAgentResult.warnings.length ? pprAgentResult.warnings.map((item, index) => <p key={`${item}-${index}`}><TriangleAlert />{item}</p>) : <p className="agent-result-empty">Дополнительных предупреждений нет.</p>}</section>
              </div>
            </div>}
          </section>}

          {projectDraft && kind === 'ppr' && <PprSectionStudio key={selected.id} task={selected} project={projectDraft} token={access.accessToken} cloud={access.mode === 'supabase'} sectionId={activePlan?.id || 'general'} onSection={id => setSelectedSectionIndex(Math.max(0, pprSectionPlan.findIndex(item => item.id === id)))} onTemplate={path => setProjectDraft({ ...projectDraft, baseTemplatePath: path })} onSaveProject={() => void saveProject()} projectSaving={projectSaving} onSaved={task => setTasks(current => current.map(item => item.id === task.id ? task : item))} />}

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

          <section className="quality-bar"><div><FileCheck2 /><span><b>Контроль документа</b><small>Сохранённые черновики ещё не являются утверждёнными разделами.</small></span></div><dl><div><dt>Документы</dt><dd>{projectDraft?.documents.length || 0}</dd></div><div><dt>Чек-лист</dt><dd>{checklistDone} / {projectDraft?.checklist.length || 0}</dd></div><div><dt>Черновики разделов</dt><dd>{kind === 'ppr' ? new Set(selected.pprDrafts?.map(item => item.sectionId)).size : 0} / {sections.length}</dd></div></dl><button disabled><Scale />Передать на проверку</button></section>
        </>}
      </section>
    </div>
  </main>;
}
