'use client';
import { NtdLibraryPanel } from '@/components/ntd-library';
/* oxlint-disable react/react-compiler, react-compiler/effect-set-state, react-hooks/exhaustive-deps */
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  ClipboardCheck,
  Download,
  FileText,
  FolderOpen,
  HardHat,
  LibraryBig,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { LoginScreen } from '@/components/login-screen';
import { WorkBriefForm, downloadJson } from '@/components/work-brief-form';
import { WorkLibrary } from '@/components/work-library';
import { WorkProjectDialog } from '@/components/work-project-dialog';
import { PprSectionStudio } from '@/components/ppr-section-studio';
import { PprDocumentWorkspace } from '@/components/ppr-document-workspace';
import { PprConnectionStatus } from '@/components/ppr-connection-status';
import './ppr-document.css';
import { workApi } from '@/lib/work-client';
import { briefIssues, isBriefApproved, readWorkBrief } from '@/lib/work-brief';
import { buildPprSectionPlan } from '@/lib/ppr-methodology';
import {
  defaultCatalog,
  defaultWorkChecklist,
  statuses,
  type Catalog,
  type Task,
  type WorkDocumentCategory,
  type WorkDocumentStatus,
  type WorkProject,
  type WorkProjectStage,
} from '@/lib/tasks';
import { useOrbitSession } from '@/lib/use-orbit-session';
import { AppVersion } from '@/components/app-version';
import './ppr-studio.css';
import './work-v2.css';

const stages: { id: WorkProjectStage; label: string }[] = [
  { id: 'source_data', label: 'Исходные данные' },
  { id: 'structure', label: 'Структура' },
  { id: 'drafting', label: 'Разработка' },
  { id: 'ntd_review', label: 'Проверка НТД' },
  { id: 'approval', label: 'Согласование' },
];
const categories: Record<WorkDocumentCategory, string> = {
  source: 'Исходные данные',
  template: 'Шаблон',
  ntd: 'НТД',
  draft: 'Черновик',
  final: 'Готовый документ',
};
const documentStatuses: Record<WorkDocumentStatus, string> = {
  expected: 'Ожидается',
  available: 'Получен',
  review: 'На проверке',
  approved: 'Проверен вручную',
};
const agents = [
  {
    name: 'Разработчик ППР',
    description: 'SOL: исходные данные, ТЗ и текстовые разделы ППР',
    icon: HardHat,
    state: 'SOL · доступ проверяется при запуске',
  },
  {
    name: 'Разработчик ТК',
    description: 'Отдельные технологические карты по заданию ППР',
    icon: FileText,
    state: 'Следующий этап',
  },
  {
    name: 'Специалист по НТД',
    description: 'Требования и ссылки на нормативные документы',
    icon: LibraryBig,
    state: 'Автопроверка не подключена',
  },
  {
    name: 'Контролёр качества',
    description: 'Полнота разделов и отсутствие противоречий',
    icon: ClipboardCheck,
    state: 'Следующий этап',
  },
];
function initialProject(task: Task): WorkProject {
  const p =
    task.workProject ||
    ({
      documentType: /(^|\s)тк([\s.,]|$)|технологическ/i.test(task.title)
        ? 'tk'
        : 'ppr',
      objectName: task.title,
      objectAddress: '',
      customer: '',
      responsible: '',
      stage: 'source_data',
      developmentMode: 'undecided',
      workType: '',
      baseTemplatePath: '',
      scheduleSource: 'unknown',
      hasWorkAtHeight: false,
      hasLiftingStructures: false,
      usesTowerCrane: false,
      hasMonolithicWork: false,
      documents: [],
      checklist: defaultWorkChecklist(),
    } as WorkProject);
  return { ...p, brief: p.brief || readWorkBrief(undefined, p) };
}
function scrollTo(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function date(value: string | null) {
  return value
    ? new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
      })
    : 'Срок не задан';
}

function ProjectWorkspace({
  task,
  token,
  cloud,
  onSaved,
  onDirty,
}: {
  task: Task;
  token: string | null;
  cloud: boolean;
  onSaved: (t: Task) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [project, setProject] = useState(() => initialProject(task));
  const [baseline, setBaseline] = useState(() => initialProject(task));
  const [revision, setRevision] = useState(task.revision);
  const [studioBusy, setStudioBusy] = useState(false);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [panel, setPanel] = useState(''),
    [section, setSection] = useState('general');
  const [documentName, setDocumentName] = useState(''),
    [category, setCategory] = useState<WorkDocumentCategory>('source'),
    [checkTitle, setCheckTitle] = useState('');
  const [library, setLibrary] = useState<{
    enabled: boolean;
    templates: { path: string; name: string }[];
  }>({ enabled: false, templates: [] });
  const changed = JSON.stringify(project) !== JSON.stringify(baseline);
  // A newly initialized empty project still needs saving before API operations,
  // but contains no edits to lose when switching to another task.
  const dirty = !task.workProject || changed;
  const conflict = revision !== task.revision;
  const approved = isBriefApproved(task, project);
  const plan = buildPprSectionPlan(project);
  const activeSection = plan.find((s) => s.id === section) || plan[0];
  const checksDone = project.checklist.filter((c) => c.completed).length;
  const approval = task.briefApprovals?.at(-1);
  const assignments = task.tkAssignments || [];
  const latestAssignments = assignments.filter(
    (a) => a.briefId === approval?.id,
  );
  const update = (p: WorkProject) => {
    if (busy || studioBusy || conflict) return;
    setProject(p);
    setNotice('');
  };
  const accept = (t: Task) => {
    const p = initialProject(t);
    setProject(p);
    setBaseline(p);
    setRevision(t.revision);
    onSaved(t);
  };
  useEffect(() => {
    // A refresh must update a clean form, but must never discard local edits.
    if (revision === task.revision || changed || busy || studioBusy) return;
    const latest = initialProject(task);
    setProject(latest);
    setBaseline(latest);
    setRevision(task.revision);
    setError('');
    setNotice('Загружена сохранённая версия ТЗ.');
  }, [task, revision, changed, busy, studioBusy]);
  useEffect(() => {
    onDirty(changed || busy || studioBusy);
    return () => onDirty(false);
  }, [changed, busy, studioBusy]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (changed || busy || studioBusy) e.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [changed, busy, studioBusy]);
  useEffect(() => {
    let alive = true;
    workApi<typeof library>('/api/work-templates', token)
      .then((v) => {
        if (alive) setLibrary(v);
      })
      .catch(() => {
        /* The library panel offers a detailed retry. */
      });
    return () => {
      alive = false;
    };
  }, [token]);
  const save = async () => {
    if (busy || studioBusy || conflict) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await workApi<{ task: Task }>(
        `/api/tasks/${task.id}`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ op: 'edit_work_project', revision, project }),
        },
      );
      accept(data.task);
      setNotice(
        `ТЗ проекта «${data.task.title}» сохранено${cloud ? ' в облаке' : ' во временной локальной базе'}. Редакция ${data.task.revision}.`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось сохранить изменения.',
      );
    } finally {
      setBusy(false);
    }
  };
  const briefAction = async (op: 'approve' | 'prepare_tk') => {
    if (busy || studioBusy || dirty || conflict) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await workApi<{ task: Task }>(
        `/api/tasks/${task.id}/work-brief`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            op,
            revision,
            confirm: true,
            acknowledgeOpenQuestions: true,
          }),
        },
      );
      accept(data.task);
      setNotice(
        op === 'approve'
          ? 'Редакция ТЗ утверждена для разработки и сохранена в истории.'
          : 'Задания по ТК подготовлены. Исполнитель пока не подключён; автоматический запуск не выполнялся.',
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось выполнить действие.',
      );
    } finally {
      setBusy(false);
    }
  };
  const addDocument = () => {
    if (!documentName.trim() || project.documents.length >= 100) return;
    update({
      ...project,
      documents: [
        ...project.documents,
        {
          id: crypto.randomUUID(),
          name: documentName.trim(),
          category,
          status: 'expected',
          version: '1.0',
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    setDocumentName('');
  };
  const addCheck = () => {
    if (!checkTitle.trim() || project.checklist.length >= 60) return;
    update({
      ...project,
      checklist: [
        ...project.checklist,
        { id: crypto.randomUUID(), title: checkTitle.trim(), completed: false },
      ],
    });
    setCheckTitle('');
  };
  const stepIndex = !approved
    ? 0
    : Math.max(1, stages.findIndex((s) => s.id === project.stage) + 1);
  const emptyDocument = (
    <article className="work-paper">
      <div className="paper-meta">
        {project.documentType.toUpperCase()} ·{' '}
        {project.brief?.code || 'Шифр не указан'}
      </div>
      <h2>{project.brief?.title || project.objectName}</h2>
      <p>{project.objectAddress || 'Адрес объекта — уточнить'}</p>
      <div className="paper-line" />
      <h3>
        {project.documentType === 'ppr'
          ? activeSection.title
          : 'Технологическая карта'}
      </h3>
      <table>
        <tbody>
          <tr>
            <th>Объект</th>
            <td>{project.objectName || 'Уточнить'}</td>
          </tr>
          <tr>
            <th>Подрядчик</th>
            <td>{project.brief?.contractor.organization || 'Уточнить'}</td>
          </tr>
          <tr>
            <th>Основной вид работ</th>
            <td>{project.workType || 'Уточнить'}</td>
          </tr>
          <tr>
            <th>Базовый шаблон</th>
            <td>{project.baseTemplatePath || 'Не выбран'}</td>
          </tr>
        </tbody>
      </table>
      <div className="paper-placeholder">
        <FileText />
        <strong>Здесь будет содержание раздела</strong>
        <p>
          {project.documentType === 'ppr'
            ? activeSection.note
            : 'Разработчик ТК будет подключён отдельно.'}
        </p>
      </div>
      <p className="paper-note">
        Каркас предпросмотра. Таблицы из DOCX ещё не импортированы. Новые и
        изменённые абзацы черновика выделяются синим.
      </p>
    </article>
  );
  return (
    <>
      <div className="project-caption">
        <span>Работа / ППР</span>
        <span>
          {statuses[task.status]} · {date(task.dueDate)}
        </span>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <output className="work-notice">
          <Check />
          {notice}
        </output>
      )}
      {conflict && (
        <div className="form-error">
          Проект обновлён в другом окне. Ваши правки остались в форме.{' '}
          <button
            onClick={() =>
              downloadJson(`TZ-unsaved-${task.id}.json`, {
                schema: 'orbit-work-brief-draft-v1',
                taskId: task.id,
                taskTitle: task.title,
                exportedAt: new Date().toISOString(),
                project,
              })
            }
          >
            Скачать мои правки
          </button>{' '}
          <button
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  'Отбросить несохранённые правки и загрузить актуальную версию?',
                )
              )
                accept(task);
            }}
          >
            Загрузить актуальные данные
          </button>
        </div>
      )}
      <fieldset
        className="workspace-fieldset"
        disabled={busy || studioBusy || conflict}
      >
        <WorkBriefForm
          task={task}
          project={project}
          onChange={update}
          dirty={dirty}
          busy={busy || studioBusy || conflict}
          onSave={() => void save()}
          onApprove={() => void briefAction('approve')}
          templates={library.templates}
          local={library.enabled}
          onLibrary={() => {
            setPanel('files');
            scrollTo('work-services');
          }}
        />
      </fieldset>
      <section
        className="work-services"
        id="work-services"
        aria-label="Состояние проекта"
      >
        <div className="service-grid">
          {[
            {
              id: 'status',
              title: 'Статус разработки',
              value:
                stages.find((s) => s.id === project.stage)?.label ||
                'Исходные данные',
              detail: approved
                ? 'ТЗ утверждено для разработки'
                : `${briefIssues(project).length} обязательных уточнений`,
              icon: HardHat,
            },
            {
              id: 'files',
              title: 'Реестр файлов',
              value: `${project.documents.length} документов`,
              detail: 'Исходные, шаблоны и версии',
              icon: FolderOpen,
            },
            {
              id: 'ntd',
              title: 'Нормативный контроль',
              value: 'Реестр и поиск',
              detail: 'Автоматическая проверка не подключена',
              icon: ShieldCheck,
            },
            {
              id: 'checklist',
              title: 'Чек-лист',
              value: `${checksDone} из ${project.checklist.length}`,
              detail: 'Ручная проверка готовности',
              icon: ClipboardCheck,
            },
          ].map((c) => (
            <button
              key={c.id}
              className={`service-card ${panel === c.id ? 'selected' : ''}`}
              onClick={() => setPanel(panel === c.id ? '' : c.id)}
              aria-expanded={panel === c.id}
              aria-controls="service-detail"
            >
              <c.icon />
              <span>{c.title}</span>
              <strong>{c.value}</strong>
              <small>{c.detail}</small>
            </button>
          ))}
        </div>
        {panel && (
          <fieldset
            id="service-detail"
            className="service-detail workspace-fieldset"
            disabled={busy || studioBusy || conflict}
          >
            {panel === 'status' && (
              <>
                <h2>Этап проекта</h2>
                <div className="brief-grid">
                  <label>
                    Текущий этап
                    <select
                      value={project.stage}
                      onChange={(e) =>
                        update({
                          ...project,
                          stage: e.target.value as WorkProjectStage,
                        })
                      }
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="hint">
                    Вы задаёте этап вручную. Он не означает, что проверка
                    специалистом уже выполнена. Статус задачи «
                    {statuses[task.status]}» остаётся общим с дашбордом.
                  </p>
                </div>
                {!!task.subtasks?.length && (
                  <div className="work-subtasks">
                    {task.subtasks.map((s) => (
                      <p key={s.id}>
                        {s.completed ? '✓' : '○'} {s.title}
                        <small>
                          {date(s.dueDate)} {s.dueTime}
                        </small>
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
            {panel === 'files' && (
              <>
                <h2>Реестр документов</h2>
                <p className="hint">
                  Здесь сохраняются названия, версии и состояние документов. Это
                  не загрузка содержимого файла.
                </p>
                <div className="register-rows">
                  {project.documents.map((d) => (
                    <div key={d.id}>
                      <input
                        aria-label={`Название документа ${d.name}`}
                        maxLength={180}
                        value={d.name}
                        onChange={(e) =>
                          update({
                            ...project,
                            documents: project.documents.map((v) =>
                              v.id === d.id
                                ? {
                                    ...v,
                                    name: e.target.value,
                                    updatedAt: new Date().toISOString(),
                                  }
                                : v,
                            ),
                          })
                        }
                      />
                      <select
                        aria-label={`Категория ${d.name}`}
                        value={d.category}
                        onChange={(e) =>
                          update({
                            ...project,
                            documents: project.documents.map((v) =>
                              v.id === d.id
                                ? {
                                    ...v,
                                    category: e.target
                                      .value as WorkDocumentCategory,
                                    updatedAt: new Date().toISOString(),
                                  }
                                : v,
                            ),
                          })
                        }
                      >
                        {Object.entries(categories).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`Версия ${d.name}`}
                        maxLength={40}
                        value={d.version}
                        onChange={(e) =>
                          update({
                            ...project,
                            documents: project.documents.map((v) =>
                              v.id === d.id
                                ? {
                                    ...v,
                                    version: e.target.value,
                                    updatedAt: new Date().toISOString(),
                                  }
                                : v,
                            ),
                          })
                        }
                      />
                      <select
                        aria-label={`Состояние ${d.name}`}
                        value={d.status}
                        onChange={(e) =>
                          update({
                            ...project,
                            documents: project.documents.map((v) =>
                              v.id === d.id
                                ? {
                                    ...v,
                                    status: e.target
                                      .value as WorkDocumentStatus,
                                    updatedAt: new Date().toISOString(),
                                  }
                                : v,
                            ),
                          })
                        }
                      >
                        {Object.entries(documentStatuses).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="icon-btn"
                        aria-label={`Удалить запись ${d.name}`}
                        onClick={() =>
                          update({
                            ...project,
                            documents: project.documents.filter(
                              (v) => v.id !== d.id,
                            ),
                          })
                        }
                      >
                        <Trash2 />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="work-add-row">
                  <input
                    aria-label="Новый документ реестра"
                    maxLength={180}
                    value={documentName}
                    onChange={(e) => setDocumentName(e.target.value)}
                    placeholder="Название документа"
                  />
                  <select
                    aria-label="Категория нового документа"
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as WorkDocumentCategory)
                    }
                  >
                    {Object.entries(categories).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="quiet-btn"
                    disabled={
                      !documentName.trim() || project.documents.length >= 100
                    }
                    onClick={addDocument}
                  >
                    <Plus />
                    Добавить запись
                  </button>
                </div>
                <button
                  className="quiet-btn"
                  onClick={() => scrollTo('work-library')}
                >
                  <FolderOpen />
                  Открыть локальные материалы
                </button>
              </>
            )}
            {panel === 'ntd' && (
              <NtdLibraryPanel key={token ?? 'local'} token={token} />
            )}
            {panel === 'checklist' && (
              <>
                <h2>Проверки перед выпуском</h2>
                <div className="check-rows">
                  {project.checklist.map((c) => (
                    <div key={c.id}>
                      <input
                        type="checkbox"
                        aria-label={`Проверено: ${c.title}`}
                        checked={c.completed}
                        onChange={(e) =>
                          update({
                            ...project,
                            checklist: project.checklist.map((v) =>
                              v.id === c.id
                                ? { ...v, completed: e.target.checked }
                                : v,
                            ),
                          })
                        }
                      />
                      <input
                        aria-label={`Пункт ${c.title}`}
                        maxLength={180}
                        value={c.title}
                        onChange={(e) =>
                          update({
                            ...project,
                            checklist: project.checklist.map((v) =>
                              v.id === c.id
                                ? { ...v, title: e.target.value }
                                : v,
                            ),
                          })
                        }
                      />
                      <button
                        className="icon-btn"
                        aria-label={`Удалить пункт ${c.title}`}
                        onClick={() =>
                          update({
                            ...project,
                            checklist: project.checklist.filter(
                              (v) => v.id !== c.id,
                            ),
                          })
                        }
                      >
                        <Trash2 />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="work-add-row">
                  <input
                    aria-label="Новый пункт проверки"
                    maxLength={180}
                    value={checkTitle}
                    onChange={(e) => setCheckTitle(e.target.value)}
                    placeholder="Что нужно проверить"
                  />
                  <button
                    className="quiet-btn"
                    disabled={
                      !checkTitle.trim() || project.checklist.length >= 60
                    }
                    onClick={addCheck}
                  >
                    <Plus />
                    Добавить пункт
                  </button>
                </div>
              </>
            )}
            {panel !== 'ntd' && (
              <button
                className="primary-btn"
                disabled={!dirty || busy}
                onClick={() => void save()}
              >
                <Save />
                Сохранить изменения
              </button>
            )}
          </fieldset>
        )}
      </section>
      <nav className="work-steps" aria-label="Шаги разработки">
        {[
          'Техническое задание',
          'Исходные данные',
          'Структура',
          'Разделы и ТК',
          'Проверки',
          'Согласование',
        ].map((name, i) => (
          <button
            key={name}
            className={stepIndex === i ? 'current' : ''}
            aria-current={stepIndex === i ? 'step' : undefined}
            onClick={() => {
              if (i === 0) scrollTo('work-brief');
              else if (i === 1 || i >= 4) {
                setPanel(i === 1 ? 'files' : i === 4 ? 'ntd' : 'status');
                scrollTo('work-services');
              } else scrollTo('working-document');
            }}
          >
            <span>{i + 1}</span>
            <b>{name}</b>
          </button>
        ))}
      </nav>
      {(project.developmentMode === 'with_tk' || assignments.length > 0) && (
        <section className="tk-handoff">
          <div>
            <span className="eyebrow">СВЯЗАННЫЕ ЗАДАНИЯ</span>
            <h2>Технологические карты</h2>
            <p>
              Из утверждённого перечня ТК. Исполнитель — отдельный агент, пока
              не подключён.
            </p>
          </div>
          <button
            className="quiet-btn"
            disabled={
              busy ||
              dirty ||
              conflict ||
              !approved ||
              project.documentType !== 'ppr' ||
              project.developmentMode !== 'with_tk' ||
              !!latestAssignments.length
            }
            onClick={() => void briefAction('prepare_tk')}
          >
            <Plus />
            Подготовить задания по ТК
          </button>
          {assignments.length > 0 && (
            <details>
              <summary>Подготовленные задания · {assignments.length}</summary>
              {assignments.map((a) => (
                <div className="tk-assignment" key={a.id}>
                  <span>
                    <strong>{a.title}</strong>
                    <small>
                      ТЗ v{a.briefVersion} ·{' '}
                      {a.briefId === approval?.id && approved
                        ? 'Ожидает исполнителя'
                        : 'Предыдущая редакция — нужна сверка'}
                    </small>
                  </span>
                  <button
                    className="quiet-btn"
                    onClick={() =>
                      downloadJson(`TK-${a.id}.json`, {
                        assignment: a,
                        brief: task.briefApprovals?.find(
                          (v) => v.id === a.briefId,
                        )?.snapshot,
                      })
                    }
                  >
                    <Download />
                    Задание
                  </button>
                </div>
              ))}
            </details>
          )}
        </section>
      )}
      <div className="workspace-editor">
        <WorkProjectDialog
          task={task}
          project={project}
          token={token}
          dirty={dirty || busy || studioBusy || conflict}
        />
        <section className="working-document" id="working-document">
          <header>
            <div>
              <span className="eyebrow">РАБОЧИЙ ДОКУМЕНТ</span>
              <h2>Содержание и версии</h2>
            </div>
            <span className="badge">Черновик · инженерная проверка</span>
          </header>
          {project.documentType === 'ppr' && (
            <PprDocumentWorkspace
              task={
                task.workProject
                  ? task
                  : { ...task, workProject: initialProject(task) }
              }
              token={token}
              locked={dirty || busy || conflict}
              lockReason={conflict ? 'Проект изменился в другом окне. Сохраните копию своих правок и обновите проект.' : dirty ? 'Сохраните изменения ТЗ, чтобы продолжить работу с документами.' : busy ? 'Дождитесь завершения сохранения проекта.' : ''}
              onSaved={accept}
              onBusyChange={setStudioBusy}
            />
          )}
          {project.documentType === 'ppr' && !task.workProject && (
            <p className="ppr-warning">
              Сохраните черновик ТЗ — здесь появятся чтение файлов, SOL и сборка
              Word. Сначала можно сохранить только известные сведения.
            </p>
          )}
          {project.documentType === 'ppr' && (
            <label className="document-section-label">
              Раздел
              <select
                value={activeSection.id}
                onChange={(e) => setSection(e.target.value)}
              >
                {plan.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {project.documentType === 'ppr' ? (
            <PprSectionStudio
              task={task}
              project={project}
              token={token}
              cloud={cloud}
              sectionId={activeSection.id}
              onTemplate={(path) =>
                update({ ...project, baseTemplatePath: path })
              }
              onSection={setSection}
              onSaveProject={() => void save()}
              projectSaving={busy || studioBusy || conflict}
              onBusyChange={setStudioBusy}
              onSaved={accept}
              embedded
              emptyPreview={emptyDocument}
            />
          ) : (
            emptyDocument
          )}
          <footer className="document-future">
            <FileText />
            <span>
              DOCX остаётся черновиком до инженерной проверки. Специалисты по
              НТД, ТК и независимому контролю ещё не подключены.
            </span>
          </footer>
        </section>
      </div>
      <section className="work-agents" aria-label="Команда агентов">
        <header>
          <div>
            <span className="eyebrow">КОМАНДА ПРОЕКТА</span>
            <h2>Каждый агент — в своей роли</h2>
          </div>
          <p>
            Показываем и будущих специалистов, чтобы был виден весь процесс.
          </p>
        </header>
        <div>
          {agents.map((a, i) => (
            <article key={a.name}>
              <a.icon />
              <h3>{a.name}</h3>
              <p>{a.description}</p>
              <span className={`badge ${i === 0 ? 'amber' : ''}`}>
                {a.state}
              </span>
              {i === 0 && (
                <button
                  className="quiet-btn"
                  onClick={() => scrollTo('project-dialog')}
                >
                  <Bot />
                  Открыть диалог
                </button>
              )}
              {i === 0 && <PprConnectionStatus token={token} />}
            </article>
          ))}
        </div>
      </section>
      <WorkLibrary token={token} />
    </>
  );
}

export default function WorkWorkspace() {
  const access = useOrbitSession();
  const [tasks, setTasks] = useState<Task[]>([]),
    [catalog, setCatalog] = useState<Catalog>(defaultCatalog);
  const [selectedId, setSelectedId] = useState(''),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const dirty = useRef(false);
  const loaded = useRef(false);
  const allowedToLeave = () =>
    !dirty.current ||
    window.confirm(
      'Есть несохранённые изменения или выполняется запрос. Продолжить переход?',
    );
  const load = async () => {
    if (access.loading || (access.mode === 'supabase' && !access.accessToken))
      return;
    setLoading(!loaded.current);
    setError('');
    try {
      const [a, b] = await Promise.all([
        workApi<{ tasks: Task[] }>('/api/tasks', access.accessToken),
        workApi<{ catalog: Catalog }>('/api/catalog', access.accessToken),
      ]);
      setTasks(a.tasks);
      setCatalog(b.catalog);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось загрузить проекты.',
      );
    } finally {
      loaded.current = true;
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [access.loading, access.mode, access.accessToken]);
  const direction = catalog.directions.find(
    (d) =>
      d.sphereId === 'work' && d.name.trim().toLocaleLowerCase('ru') === 'ппр',
  );
  const workTasks = tasks
    .filter((t) => t.sphere === 'work' && t.directionId === direction?.id)
    .sort(
      (a, b) =>
        Number(b.focus) - Number(a.focus) ||
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
    );
  const selected = workTasks.find((t) => t.id === selectedId) || workTasks[0];
  const filtered = workTasks.filter(
    (t) =>
      t.title
        .toLocaleLowerCase('ru')
        .includes(query.trim().toLocaleLowerCase('ru')) ||
      t.id === selected?.id,
  );
  if (access.loading)
    return (
      <main className="work-shell work-loading">
        <LoaderCircle className="spin" />
        Открываем рабочее пространство…
      </main>
    );
  if (access.error || (access.mode === 'supabase' && !access.accessToken))
    return (
      <LoginScreen
        onSignIn={access.signIn}
        onSignUp={access.signUp}
        setupError={access.error}
      />
    );
  return (
    <main className="work-shell">
      <header className="works-topbar">
        <div className="works-brand">
          <HardHat />
          <span>
            <strong>ORBIT WORKS</strong>
            <small>Мастерская ППР и ТК</small>
            <AppVersion />
          </span>
        </div>
        <Link
          href="/"
          onClick={(e) => {
            if (!allowedToLeave()) e.preventDefault();
          }}
        >
          <ArrowLeft />
          Назад к задачам
        </Link>
      </header>
      <div className="project-toolbar">
        <div>
          <span className="eyebrow">РАБОЧИЙ ПРОЕКТ</span>
          <label>
            <span className="sr-only">Выбрать проект</span>
            <select
              value={selected?.id || ''}
              onChange={(e) => {
                if (allowedToLeave()) setSelectedId(e.target.value);
                else e.currentTarget.value = selected?.id || '';
              }}
            >
              {filtered.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
              {!selected && (
                <option value="">Нет проектов в направлении ППР</option>
              )}
            </select>
          </label>
        </div>
        <input
          aria-label="Поиск проекта"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти проект…"
        />
        <button
          className="icon-btn"
          aria-label="Обновить проекты"
          disabled={loading}
          onClick={() => {
            if (allowedToLeave()) void load();
          }}
        >
          <RefreshCw />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="work-loading">
          <LoaderCircle className="spin" />
          Загружаем проекты…
        </p>
      ) : selected ? (
        <ProjectWorkspace
          key={selected.id}
          task={selected}
          token={access.accessToken}
          cloud={access.mode === 'supabase'}
          onSaved={(t) =>
            setTasks((current) => current.map((v) => (v.id === t.id ? t : v)))
          }
          onDirty={(value) => {
            dirty.current = value;
          }}
        />
      ) : (
        <section className="brief-card work-empty">
          <FolderOpen />
          <h1>Выберите первый проект</h1>
          <p>
            Сюда попадают только задачи из сферы «Работа», направления «ППР».
          </p>
          <Link href="/">Открыть дашборд</Link>
        </section>
      )}
    </main>
  );
}
