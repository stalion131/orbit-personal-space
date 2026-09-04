'use client';
import { useState } from 'react';
import { riskLabels, readWorkBrief, type RiskState } from '@/lib/work-brief';
import { permitRiskLabels, type PermitRiskId } from '@/lib/permit-risk-catalog';
import type { WorkProject } from '@/lib/tasks';

export function WorkRiskPicker({
  project: p,
  onChange,
}: {
  project: WorkProject;
  onChange: (p: WorkProject) => void;
}) {
  const [query, setQuery] = useState('');
  const b = p.brief || readWorkBrief(undefined, p);
  const items = [
    ...Object.entries(riskLabels).map(([id, label]) => ({
      id,
      label,
      group: 'Базовые условия',
      state: b.risks[id as keyof typeof riskLabels],
    })),
    ...Object.entries(permitRiskLabels).map(([id, label]) => ({
      id,
      label,
      group: 'Сценарии из реестра нарядов-допусков',
      state: b.permitRisks?.[id as PermitRiskId] || ('unknown' as RiskState),
    })),
  ];
  const change = (id: string, state: RiskState) => {
    if (Object.hasOwn(permitRiskLabels, id)) {
      onChange({
        ...p,
        brief: { ...b, permitRisks: { ...b.permitRisks, [id]: state } },
      });
      return;
    }
    onChange({
      ...p,
      hasWorkAtHeight: id === 'height' ? state === 'yes' : p.hasWorkAtHeight,
      hasLiftingStructures:
        id === 'lifting' ? state === 'yes' : p.hasLiftingStructures,
      usesTowerCrane:
        id === 'lifting' && state !== 'yes' ? false : p.usesTowerCrane,
      brief: { ...b, risks: { ...b.risks, [id]: state } },
    });
  };
  const selected = items.filter((i) => i.state === 'yes');
  return (
    <div className="work-risk-picker">
      <details>
        <summary>
          Риски и особые условия{' '}
          <span>
            {selected.length} отмечено ·{' '}
            {items.filter((i) => i.state === 'unknown').length} уточнить
          </span>
        </summary>
        <div className="risk-picker-content">
          <input
            aria-label="Поиск риска"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Например: земляные, высота, ОПО…"
          />
          <p className="hint">
            Галочка — работы предусмотрены. «Нет» — явно исключены. Без решения
            — «Уточнить». Наличие сценария не определяет автоматически
            необходимость наряда.
          </p>
          <div className="risk-picker-list">
            {['Базовые условия', 'Сценарии из реестра нарядов-допусков'].map(
              (group) => (
                <section key={group}>
                  <h4>{group}</h4>
                  {items
                    .filter(
                      (i) =>
                        i.group === group &&
                        `${i.id} ${i.label}`
                          .toLocaleLowerCase('ru')
                          .includes(query.toLocaleLowerCase('ru')),
                    )
                    .map((i) => (
                      <div className={`risk-picker-row ${i.state}`} key={i.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={i.state === 'yes'}
                            onChange={(e) =>
                              change(i.id, e.target.checked ? 'yes' : 'unknown')
                            }
                          />
                          {i.label}
                        </label>
                        <div className="risk-picker-state">
                          <span>
                            {i.state === 'yes'
                              ? 'Да'
                              : i.state === 'no'
                                ? 'Нет'
                                : 'Уточнить'}
                          </span>
                          <button
                            type="button"
                            aria-label={`Исключить: ${i.label}`}
                            aria-pressed={i.state === 'no'}
                            onClick={() =>
                              change(i.id, i.state === 'no' ? 'unknown' : 'no')
                            }
                          >
                            Нет
                          </button>
                          {i.state !== 'unknown' && (
                            <button
                              type="button"
                              aria-label={`Уточнить: ${i.label}`}
                              onClick={() => change(i.id, 'unknown')}
                            >
                              ?
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                </section>
              ),
            )}
          </div>
        </div>
      </details>
      {selected.length > 0 && (
        <p className="risk-selection-summary">
          {selected
            .slice(0, 3)
            .map((i) => i.label)
            .join(' · ') +
            (selected.length > 3 ? ' · ещё ' + (selected.length - 3) : '')}
        </p>
      )}
    </div>
  );
}
