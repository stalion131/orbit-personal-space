'use client';
/* oxlint-disable react-compiler/effect-set-state */
import { useState } from 'react';
import {
  ChevronDown,
  Check,
  FileText,
  FolderOpen,
  Info,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import {
  briefIssues,
  briefSnapshot,
  briefWarnings,
  isBriefApproved,
  readWorkBrief,
  riskLabels,
  type RiskState,
  type Signatory,
  type WorkBrief,
} from '@/lib/work-brief';
import type { Task, WorkProject } from '@/lib/tasks';

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function EntryList({
  label,
  values,
  onChange,
  maximum = 30,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  maximum?: number;
}) {
  const [value, setValue] = useState('');
  const add = () => {
    if (
      value.trim() &&
      values.length < maximum &&
      !values.some((v) => v.toLowerCase() === value.trim().toLowerCase())
    ) {
      onChange([...values, value.trim()]);
      setValue('');
    }
  };
  return (
    <div className="brief-list">
      <span className="field-label">{label}</span>
      {values.map((item, index) => (
        <div key={index}>
          <input
            aria-label={`${label} ${index + 1}`}
            value={item}
            maxLength={200}
            onChange={(e) =>
              onChange(values.map((v, i) => (i === index ? e.target.value : v)))
            }
          />
          <button
            type="button"
            className="icon-btn"
            aria-label={`Удалить ${item || 'запись'}`}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          >
            <Trash2 />
          </button>
        </div>
      ))}
      <div>
        <input
          aria-label={`Новая запись: ${label}`}
          value={value}
          maxLength={200}
          placeholder="Добавить в перечень"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={`Добавить: ${label}`}
          disabled={!value.trim() || values.length >= maximum}
          onClick={add}
        >
          <Plus />
        </button>
      </div>
    </div>
  );
}
function Party({
  label,
  party,
  onChange,
}: {
  label: string;
  party: Signatory;
  onChange: (v: Signatory) => void;
}) {
  return (
    <section className="brief-party">
      <h3>{label}</h3>
      {(
        [
          ['organization', 'Организация', 200],
          ['position', 'Должность', 160],
          ['fullName', 'ФИО', 160],
          ['authority', 'Основание полномочий / указание', 500],
        ] as const
      ).map(([key, text, max]) => (
        <label key={key}>
          {text}
          <input
            value={party[key]}
            maxLength={max}
            placeholder={
              key === 'authority'
                ? 'Приказ, доверенность или указание — уточнить'
                : 'Пока не указано'
            }
            onChange={(e) => onChange({ ...party, [key]: e.target.value })}
          />
        </label>
      ))}
      <p className="hint">
        Должность по умолчанию — предварительная. ФИО и полномочия требуют
        подтверждения.
      </p>
    </section>
  );
}
type Props = {
  task: Task;
  project: WorkProject;
  onChange: (p: WorkProject) => void;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onApprove: () => void;
  templates: { path: string; name: string }[];
  local: boolean;
  onLibrary: () => void;
};
export function WorkBriefForm({
  task,
  project: p,
  onChange,
  dirty,
  busy,
  onSave,
  onApprove,
  templates,
  local,
  onLibrary,
}: Props) {
  const b = p.brief || readWorkBrief(undefined, p);
  const approved = isBriefApproved(task, p);
  const [view, setView] = useState<'auto' | 'open' | 'closed'>('auto');
  const collapsed = view === 'closed' || (view === 'auto' && approved);
  const setCollapsed = (v: boolean) => setView(v ? 'closed' : 'open');
  const [confirmation, setConfirmation] = useState('');
  const key = JSON.stringify(briefSnapshot(p));
  const confirmed = confirmation === key;
  const setConfirmed = (v: boolean) => setConfirmation(v ? key : '');
  const edit = (patch: Partial<WorkBrief>) =>
    onChange({ ...p, brief: { ...b, ...patch } });
  const issues = briefIssues(p),
    warnings = briefWarnings(p);
  const docType = p.documentType === 'tk' ? 'tk' : p.developmentMode;
  return (
    <section className="brief-card" id="work-brief">
      <header className="brief-header">
        <div>
          <span className="eyebrow">ИСХОДНЫЕ ДАННЫЕ ПРОЕКТА</span>
          <h1>Техническое задание</h1>
          <p>Заполните известное. Уточнения можно внести перед разработкой.</p>
        </div>
        <div className="brief-heading-actions">
          <span className={`badge ${approved ? 'success' : 'amber'}`}>
            {approved
              ? `ТЗ утверждено · v${task.briefApprovals?.at(-1)?.version}`
              : task.briefApprovals?.length
                ? 'Нужно переутвердить'
                : 'Черновик ТЗ'}
          </span>
          <button
            type="button"
            className="quiet-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
          >
            <ChevronDown />
            {collapsed ? 'Открыть форму' : 'Свернуть'}
          </button>
        </div>
      </header>
      {collapsed ? (
        <div className="brief-summary">
          <FileText />
          <div>
            <strong>
              {b.code || 'Без шифра'} · {b.title || p.objectName}
            </strong>
            <p>
              {p.workType || 'Вид работ не указан'} ·{' '}
              {p.documentType === 'tk'
                ? 'ТК'
                : p.developmentMode === 'with_tk'
                  ? 'ППР с ТК'
                  : p.developmentMode === 'without_tk'
                    ? 'ППР без ТК'
                    : 'Тип не выбран'}
            </p>
          </div>
          <button className="quiet-btn" onClick={() => setCollapsed(false)}>
            Редактировать ТЗ
          </button>
        </div>
      ) : (
        <>
          <section className="brief-group">
            <h2>
              <span>01</span>Документ и объект
            </h2>
            <div className="brief-grid three">
              <label>
                Вид документа
                <select
                  value={docType}
                  onChange={(e) =>
                    onChange({
                      ...p,
                      documentType: e.target.value === 'tk' ? 'tk' : 'ppr',
                      developmentMode:
                        e.target.value === 'tk'
                          ? 'undecided'
                          : (e.target.value as WorkProject['developmentMode']),
                    })
                  }
                >
                  <option value="undecided">Выберите тип</option>
                  <option value="with_tk">ППР с ТК</option>
                  <option value="without_tk">ППР без ТК</option>
                  <option value="tk">ТК</option>
                </select>
              </label>
              <label>
                Шифр документа
                <input
                  value={b.code}
                  maxLength={100}
                  onChange={(e) => edit({ code: e.target.value })}
                  placeholder="Например: ППР-2026-001"
                />
              </label>
              <label>
                Наименование документа
                <input
                  value={b.title}
                  maxLength={300}
                  onChange={(e) => edit({ title: e.target.value })}
                  placeholder="Полное название ППР или ТК"
                />
              </label>
              <label>
                Объект
                <input
                  value={p.objectName}
                  maxLength={240}
                  onChange={(e) =>
                    onChange({ ...p, objectName: e.target.value })
                  }
                  placeholder="Название объекта"
                />
                <small>Из карточки проекта · можно уточнить</small>
              </label>
              <label>
                Адрес объекта
                <input
                  value={p.objectAddress}
                  maxLength={300}
                  onChange={(e) =>
                    onChange({ ...p, objectAddress: e.target.value })
                  }
                  placeholder="Пока не указан"
                />
              </label>
              <label>
                Основной вид работ
                <input
                  value={p.workType}
                  maxLength={300}
                  onChange={(e) => onChange({ ...p, workType: e.target.value })}
                  placeholder="Например: монолитные работы"
                />
              </label>
            </div>
            <details className="brief-extra">
              <summary>
                Уточнение вида документа и ответственный разработчик
              </summary>
              <div className="brief-grid">
                <label>
                  Вид документа — ручное уточнение
                  <input
                    value={b.documentLabel}
                    maxLength={160}
                    onChange={(e) => edit({ documentLabel: e.target.value })}
                    placeholder="Уточняющее название; выбранный тип сохраняется"
                  />
                </label>
                <label>
                  Ответственный за разработку
                  <input
                    value={p.responsible}
                    maxLength={160}
                    onChange={(e) =>
                      onChange({ ...p, responsible: e.target.value })
                    }
                    placeholder="Не подменяет подписантов сторон"
                  />
                </label>
              </div>
            </details>
          </section>
          <section className="brief-group">
            <h2>
              <span>02</span>Стороны и подписанты
            </h2>
            <div className="brief-grid">
              <Party
                label="Утверждаю · Подрядчик"
                party={b.contractor}
                onChange={(v) => edit({ contractor: v })}
              />
              <Party
                label="Согласовано · Заказчик"
                party={b.customer}
                onChange={(v) =>
                  onChange({
                    ...p,
                    customer: v.organization,
                    brief: { ...b, customer: v },
                  })
                }
              />
            </div>
            <p className="info-line">
              <Info />
              ППР выпускается от лица Подрядчика. Мы — разработчик по
              субподряду.
            </p>
          </section>
          <section className="brief-group">
            <h2>
              <span>03</span>Указания и условия работ
            </h2>
            <div className="brief-grid">
              <div className="brief-stack">
                {(
                  [
                    [
                      'siteInstructions',
                      'Организация стройплощадки',
                      'Проезды, складирование, ограждения, бытовой городок…',
                    ],
                    [
                      'methods',
                      'Методы выполнения работ',
                      'Последовательность, выбранная технология, ограничения…',
                    ],
                    [
                      'contractorInput',
                      'Вводные от Подрядчика',
                      'Доступ на объект, режим работ и особые условия…',
                    ],
                  ] as const
                ).map(([field, label, placeholder]) => (
                  <label key={field}>
                    {label}
                    <textarea
                      rows={4}
                      maxLength={3000}
                      value={b[field]}
                      placeholder={placeholder}
                      onChange={(e) => edit({ [field]: e.target.value })}
                    />
                  </label>
                ))}
                <label>
                  Дополнительные указания
                  <textarea
                    rows={3}
                    maxLength={3000}
                    value={b.additional}
                    onChange={(e) => edit({ additional: e.target.value })}
                    placeholder="Что ещё нужно учесть при разработке"
                  />
                </label>
              </div>
              <div className="brief-stack">
                <label>
                  Перечень техники
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={b.equipment}
                    onChange={(e) => edit({ equipment: e.target.value })}
                    placeholder="Укажите, если нет в исходных данных"
                  />
                </label>
                <div className="brief-grid">
                  <label>
                    Количество человек
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      step={1}
                      value={b.people ?? ''}
                      onChange={(e) =>
                        edit({
                          people:
                            e.target.value === ''
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      placeholder="Уточнить"
                    />
                  </label>
                  <label>
                    Состав бригад
                    <input
                      value={b.crew}
                      maxLength={500}
                      onChange={(e) => edit({ crew: e.target.value })}
                      placeholder="Профессии и смены"
                    />
                  </label>
                </div>
                <div>
                  <span className="field-label">Риски и особые условия</span>
                  <div className="risk-grid">
                    {Object.entries(riskLabels).map(([key, label]) => (
                      <label
                        className={`risk ${b.risks[key as keyof typeof riskLabels]}`}
                        key={key}
                      >
                        {label}
                        <select
                          value={b.risks[key as keyof typeof riskLabels]}
                          onChange={(e) => {
                            const state = e.target.value as RiskState;
                            onChange({
                              ...p,
                              hasWorkAtHeight:
                                key === 'height'
                                  ? state === 'yes'
                                  : p.hasWorkAtHeight,
                              hasLiftingStructures:
                                key === 'lifting'
                                  ? state === 'yes'
                                  : p.hasLiftingStructures,
                              usesTowerCrane:
                                key === 'lifting' && state !== 'yes'
                                  ? false
                                  : p.usesTowerCrane,
                              brief: {
                                ...b,
                                risks: { ...b.risks, [key]: state },
                              },
                            });
                          }}
                        >
                          <option value="unknown">Уточнить</option>
                          <option value="yes">Да</option>
                          <option value="no">Нет</option>
                        </select>
                      </label>
                    ))}
                  </div>
                  <label>
                    Другие риски
                    <input
                      value={b.otherRisks}
                      maxLength={1000}
                      onChange={(e) => edit({ otherRisks: e.target.value })}
                      placeholder="Опишите дополнительные условия"
                    />
                  </label>
                </div>
                <div className="brief-checks">
                  <label>
                    <input
                      type="checkbox"
                      checked={p.usesTowerCrane}
                      onChange={(e) =>
                        onChange({
                          ...p,
                          usesTowerCrane: e.target.checked,
                          hasLiftingStructures:
                            e.target.checked || p.hasLiftingStructures,
                          brief: {
                            ...b,
                            risks: {
                              ...b.risks,
                              lifting: e.target.checked
                                ? 'yes'
                                : b.risks.lifting,
                            },
                          },
                        })
                      }
                    />
                    Башенный кран · ссылка на ППРк
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={p.hasMonolithicWork}
                      onChange={(e) =>
                        onChange({ ...p, hasMonolithicWork: e.target.checked })
                      }
                    />
                    Монолитные работы
                  </label>
                </div>
                <EntryList
                  label="Перечень ТК"
                  values={b.tkList}
                  onChange={(v) => edit({ tkList: v })}
                />
                {p.developmentMode !== 'with_tk' && !!b.tkList.length && (
                  <p className="hint">
                    Перечень сохранён. Задания создаются только для типа «ППР с
                    ТК».
                  </p>
                )}
              </div>
            </div>
          </section>
          <section className="brief-group">
            <h2>
              <span>04</span>Графики и рабочие материалы
            </h2>
            <div className="brief-grid three">
              <label>
                Источник графиков
                <select
                  value={p.scheduleSource}
                  onChange={(e) =>
                    onChange({
                      ...p,
                      scheduleSource: e.target
                        .value as WorkProject['scheduleSource'],
                    })
                  }
                >
                  <option value="unknown">Пока не определён</option>
                  <option value="contractor">Предоставляет Подрядчик</option>
                  <option value="draft">Разработать укрупнённо</option>
                </select>
              </label>
              <label>
                Рабочая папка
                <input
                  value={b.workingFolder}
                  maxLength={1000}
                  onChange={(e) => edit({ workingFolder: e.target.value })}
                  placeholder="Путь к папке проекта"
                />
                <small>
                  Путь сохраняется как реквизит. Доступ ограничен локальной
                  библиотекой.
                </small>
              </label>
              <label>
                Базовый шаблон
                <input
                  list="brief-templates"
                  value={p.baseTemplatePath}
                  maxLength={1000}
                  onChange={(e) =>
                    onChange({ ...p, baseTemplatePath: e.target.value })
                  }
                  placeholder={
                    local
                      ? 'Выберите или введите путь'
                      : 'Название или относительный путь'
                  }
                />
                <datalist id="brief-templates">
                  {templates.map((t) => (
                    <option key={t.path} value={t.path}>
                      {t.name}
                    </option>
                  ))}
                </datalist>
                <small>
                  {local
                    ? 'Из локальной библиотеки или вручную'
                    : 'Локальная библиотека доступна на компьютере'}
                </small>
              </label>
            </div>
            <div className="schedule-chips">
              {[
                'Производство работ',
                'Движение техники',
                'Движение персонала',
                'Поставка материалов',
              ].map((name) => (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={b.schedules.includes(name)}
                    onChange={(e) =>
                      edit({
                        schedules: e.target.checked
                          ? [...b.schedules, name]
                          : b.schedules.filter((v) => v !== name),
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
            <label>
              Указания по графикам
              <textarea
                rows={2}
                maxLength={1000}
                value={b.scheduleNotes}
                onChange={(e) => edit({ scheduleNotes: e.target.value })}
                placeholder="Сроки, сменность, дополнительные графики и допущения"
              />
            </label>
          </section>
          <footer className="brief-footer">
            <div className="hint">
              {dirty
                ? 'Есть несохранённые изменения'
                : 'Все изменения сохранены'}
              <br />
              После сохранения загрузите файлы в блоке «Рабочий документ».
              SOL предложит заполнение; выбранные поля применяются только после проверки.
            </div>
            <button className="quiet-btn" onClick={onLibrary}>
              <FolderOpen />
              Исходные материалы
            </button>
            <button
              className="primary-btn"
              onClick={onSave}
              disabled={busy || !dirty}
            >
              <Save />
              {busy ? 'Сохраняем…' : 'Сохранить ТЗ'}
            </button>
          </footer>
          {!approved && (
            <div className="brief-approval">
              <div>
                <strong>Утверждение для разработки</strong>
                {issues.length > 0 && (
                  <p className="amber-text">{issues.join(' ')}</p>
                )}
                <details>
                  <summary>Открытые вопросы · {warnings.length}</summary>
                  {warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </details>
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy || dirty || !!issues.length}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Я проверил ТЗ и открытые вопросы. Утверждаю эту редакцию для
                  разработки, не для производства работ.
                </label>
              </div>
              <button
                className="primary-btn"
                onClick={() => {
                  setView('auto');
                  onApprove();
                }}
                disabled={!confirmed || dirty || busy || !!issues.length}
              >
                <Check />
                Утвердить ТЗ
              </button>
            </div>
          )}
        </>
      )}
      {!!task.briefApprovals?.length && (
        <details className="brief-history">
          <summary>История ТЗ · {task.briefApprovals.length} редакций</summary>
          {[...task.briefApprovals].reverse().map((item) => (
            <div key={item.id}>
              <span>
                Редакция {item.version} ·{' '}
                {new Date(item.at).toLocaleString('ru-RU')}
              </span>
              <button
                className="quiet-btn"
                onClick={() => downloadJson(`TZ-v${item.version}.json`, item)}
              >
                Скачать снимок
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
