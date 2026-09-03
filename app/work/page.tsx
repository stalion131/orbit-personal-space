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
  FileCheck2,
  FileText,
  FolderOpen,
  HardHat,
  LibraryBig,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { LoginScreen } from '@/components/login-screen';
import { defaultCatalog, statuses, type Catalog, type Task } from '@/lib/tasks';
import { useOrbitSession } from '@/lib/use-orbit-session';
import './workspace.css';

type DocumentKind = 'ppr' | 'tk';

const documentSections: Record<DocumentKind, string[]> = {
  ppr: ['Общие данные', 'Организация работ', 'Технология производства', 'Машины и механизмы', 'Контроль качества', 'Охрана труда'],
  tk: ['Область применения', 'Организация процесса', 'Технологические операции', 'Материалы и механизмы', 'Контроль качества', 'Охрана труда'],
};

const professionalAgents = [
  { name: 'Разработчик ППР', description: 'Собирает разделы ППР по шаблону', icon: HardHat, state: 'Следующий этап' },
  { name: 'Разработчик ТК', description: 'Готовит технологическую карту', icon: FileText, state: 'Следующий этап' },
  { name: 'Специалист по НТД', description: 'Проверяет требования по вашей базе', icon: LibraryBig, state: 'Ждёт базу НТД' },
  { name: 'Контролёр качества', description: 'Ищет пропуски и противоречия', icon: ClipboardCheck, state: 'Следующий этап' },
];

async function api<T>(path: string, token: string | null): Promise<T> {
  const headers = new Headers({ 'X-Orbit-Client': 'dashboard' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { cache: 'no-store', headers });
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

export default function WorkWorkspace() {
  const access = useOrbitSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [catalog, setCatalog] = useState<Catalog>(defaultCatalog);
  const [selectedId, setSelectedId] = useState('');
  const [kind, setKind] = useState<DocumentKind>('ppr');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      const workTasks = taskData.tasks.filter(task => task.sphere === 'work');
      setSelectedId(current => workTasks.some(task => task.id === current) ? current : workTasks[0]?.id || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Нет соединения с сервером.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { queueMicrotask(() => void load()); }, [access.loading, access.mode, access.accessToken]);

  const workTasks = useMemo(() => tasks
    .filter(task => task.sphere === 'work')
    .filter(task => !query.trim() || task.title.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
    .sort((a, b) => Number(b.focus) - Number(a.focus) || (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31')),
  [tasks, query]);
  const selected = tasks.find(task => task.id === selectedId) || workTasks[0];
  const selectedDirection = selected ? catalog.directions.find(item => item.id === selected.directionId)?.name : '';
  const progress = selected ? taskProgress(selected) : 0;
  const sections = documentSections[kind];

  useEffect(() => { if (selected) setKind(taskKind(selected)); }, [selected?.id]);

  if (access.loading) return <main className="work-auth"><LoaderCircle className="spin" />Загружаем рабочее пространство…</main>;
  if (access.error || (access.mode === 'supabase' && !access.accessToken)) return <LoginScreen onSignIn={access.signIn} onSignUp={access.signUp} setupError={access.error} />;

  return <main className="work-app">
    <header className="work-topbar">
      <div className="work-brand"><span><HardHat /></span><div><strong>ORBIT WORKS</strong><small>разработка ППР и ТК</small></div></div>
      <nav className="work-mode" aria-label="Режим документа">
        <button className={kind === 'ppr' ? 'active' : ''} onClick={() => setKind('ppr')}>ППР</button>
        <button className={kind === 'tk' ? 'active' : ''} onClick={() => setKind('tk')}>ТК</button>
      </nav>
      <div className="work-top-actions"><button className="work-icon-button" aria-label="Обновить проекты" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /></button><Link href="/" className="work-back"><ArrowLeft />К задачам</Link></div>
    </header>

    {error && <div className="work-feedback"><CircleAlert />{error}</div>}

    <div className="work-shell">
      <aside className="work-sidebar">
        <div className="side-heading"><span>РАБОЧИЕ ПРОЕКТЫ</span><b>{workTasks.length}</b></div>
        <label className="work-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти проект" /></label>
        <div className="project-list">
          {workTasks.map(task => <button key={task.id} className={task.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(task.id)}>
            <span className="project-file"><FileText /></span><span><strong>{task.title}</strong><small>{catalog.directions.find(item => item.id === task.directionId)?.name || 'Без направления'}</small></span><ChevronRight />
          </button>)}
          {!loading && !workTasks.length && <div className="side-empty"><FolderOpen /><span>В сфере «Работа» пока нет подходящих задач.</span></div>}
        </div>
        <Link href="/" className="new-work-task"><Plus />Добавить рабочую задачу</Link>
        <div className="side-heading agent-heading"><span>ПРОФЕССИОНАЛЬНЫЕ АГЕНТЫ</span></div>
        <div className="work-agents">{professionalAgents.map(agent => { const Icon = agent.icon; return <button key={agent.name} disabled><span><Icon /></span><span><strong>{agent.name}</strong><small>{agent.description}</small></span><em>{agent.state}</em></button>; })}</div>
      </aside>

      <section className="work-content">
        {!selected ? <div className="work-empty"><FolderOpen /><h1>Выберите рабочий проект</h1><p>Создайте задачу в сфере «Работа», и она появится здесь автоматически.</p><Link href="/">Перейти к задачам</Link></div> : <>
          <header className="project-header">
            <div><span className="project-kicker">{kind === 'ppr' ? 'ПРОЕКТ ПРОИЗВОДСТВА РАБОТ' : 'ТЕХНОЛОГИЧЕСКАЯ КАРТА'}</span><h1>{selected.title}</h1><p>{selectedDirection || 'Без направления'} · {statuses[selected.status]} · {selected.dueDate ? `до ${dateLabel(selected.dueDate)}` : 'срок не задан'}</p></div>
            <div className="project-progress"><span><b>{progress}%</b> прогресс задачи</span><i><b style={{ width: `${progress}%` }} /></i></div>
          </header>

          <div className="workflow-strip">
            {['Исходные данные', 'Структура', 'Разработка', 'Проверка НТД', 'Согласование'].map((step, index) => <div className={index === 0 ? 'current' : ''} key={step}><span>{index === 0 ? <Check /> : index + 1}</span><b>{step}</b></div>)}
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
              <section className="work-panel files-panel"><header><div><span>ИСХОДНЫЕ ДАННЫЕ</span><h2>Файлы проекта</h2></div><Upload /></header><div className="files-empty"><FolderOpen /><b>Файлы пока не подключены</b><p>На следующем этапе добавим безопасное рабочее хранилище.</p><button disabled><Plus />Добавить файлы</button></div></section>
              <section className="work-panel ntd-panel"><header><div><span>НОРМАТИВНЫЙ КОНТРОЛЬ</span><h2>Специалист по НТД</h2></div><LibraryBig /></header><div className="agent-status"><i /><span><b>Подготовлен интерфейс</b><small>Агент начнёт проверку после подключения вашей базы НТД.</small></span></div><button disabled><ShieldCheck />Проверить раздел</button></section>
            </aside>
          </div>

          <section className="quality-bar"><div><FileCheck2 /><span><b>Контроль документа</b><small>Проверки станут доступны после подключения шаблонов и НТД.</small></span></div><dl><div><dt>Разделы</dt><dd>0 / {sections.length}</dd></div><div><dt>Замечания</dt><dd>—</dd></div><div><dt>Нормативы</dt><dd>—</dd></div></dl><button disabled><Scale />Передать на проверку</button></section>
        </>}
      </section>
    </div>
  </main>;
}
