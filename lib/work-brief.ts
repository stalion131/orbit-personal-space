import type { Task, WorkProject } from './tasks';
import { permitRiskLabels, type PermitRiskId } from './permit-risk-catalog.ts';

export const riskLabels = {
  height: 'Работы на высоте',
  lifting: 'Подъёмные сооружения',
  fire: 'Огневые работы',
  electrical: 'Электроустановки',
  confined: 'Замкнутые пространства',
} as const;
export type RiskState = 'unknown' | 'yes' | 'no';
export type Signatory = {
  organization: string;
  position: string;
  fullName: string;
  authority: string;
};
export type WorkBrief = {
  documentLabel: string;
  code: string;
  title: string;
  contractor: Signatory;
  customer: Signatory;
  siteInstructions: string;
  methods: string;
  equipment: string;
  people: number | null;
  crew: string;
  contractorInput: string;
  additional: string;
  workingFolder: string;
  scheduleNotes: string;
  schedules: string[];
  tkList: string[];
  risks: Record<keyof typeof riskLabels, RiskState>;
  otherRisks: string;
  permitRisks?: Partial<Record<PermitRiskId, RiskState>>;
};
export type BriefSnapshot = Pick<
  WorkProject,
  | 'documentType'
  | 'developmentMode'
  | 'objectName'
  | 'objectAddress'
  | 'customer'
  | 'responsible'
  | 'workType'
  | 'baseTemplatePath'
  | 'scheduleSource'
  | 'usesTowerCrane'
  | 'hasMonolithicWork'
  | 'hasWorkAtHeight'
  | 'hasLiftingStructures'
> & { brief: WorkBrief };
export type BriefApproval = {
  id: string;
  version: number;
  at: string;
  snapshot: BriefSnapshot;
};
export type TkAssignment = {
  id: string;
  title: string;
  briefId: string;
  briefVersion: number;
  createdAt: string;
  status: 'prepared';
  executor: 'tk_developer';
};
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Неверный формат ТЗ.');
  return v as Record<string, unknown>;
};
const string = (v: unknown, max: number, fallback = '') => {
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || v.length > max || v.includes('\0'))
    throw new Error('Поле ТЗ имеет неверный формат или слишком длинное.');
  return v.trim();
};
function strings(v: unknown, maxItems: number, maxText: number): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > maxItems)
    throw new Error('Слишком много записей ТЗ.');
  const values = v.map((item) => string(item, maxText));
  if (
    values.some((item) => !item) ||
    new Set(values.map((item) => item.toLocaleLowerCase('ru'))).size !==
      values.length
  )
    throw new Error('Удалите пустые и повторяющиеся записи ТЗ.');
  return values;
}
function signatory(v: unknown, fallback = ''): Signatory {
  const data = v === undefined ? {} : object(v);
  return {
    organization: string(data.organization, 200, fallback),
    position: string(data.position, 160),
    fullName: string(data.fullName, 160),
    authority: string(data.authority, 500),
  };
}
export function readWorkBrief(
  v: unknown,
  legacy: Partial<WorkProject> = {},
): WorkBrief {
  const d = v === undefined ? {} : object(v);
  const permitRisks: Partial<Record<PermitRiskId, RiskState>> = {};
  if (d.permitRisks !== undefined) {
    for (const [id, state] of Object.entries(object(d.permitRisks))) {
      if (
        !Object.hasOwn(permitRiskLabels, id) ||
        typeof state !== 'string' ||
        !['yes', 'no', 'unknown'].includes(state)
      )
        throw new Error('Неверный сценарий риска.');
      permitRisks[id as PermitRiskId] = state as RiskState;
    }
  }
  const riskValues = d.risks === undefined ? {} : object(d.risks);
  const risks = Object.fromEntries(
    Object.keys(riskLabels).map((key) => {
      const state =
        riskValues[key] ??
        ((key === 'height' && legacy.hasWorkAtHeight) ||
        (key === 'lifting' &&
          (legacy.hasLiftingStructures || legacy.usesTowerCrane))
          ? 'yes'
          : 'unknown');
      if (
        typeof state !== 'string' ||
        !['unknown', 'yes', 'no'].includes(state)
      )
        throw new Error('Неверное состояние риска.');
      return [key, state];
    }),
  ) as WorkBrief['risks'];
  if (
    d.people !== undefined &&
    d.people !== null &&
    (!Number.isInteger(d.people) ||
      Number(d.people) < 1 ||
      Number(d.people) > 100000)
  )
    throw new Error('Численность должна быть целым числом от 1 до 100 000.');
  return {
    documentLabel: string(d.documentLabel, 160),
    code: string(d.code, 100),
    title: string(d.title, 300),
    contractor: signatory(d.contractor),
    customer: signatory(d.customer, legacy.customer),
    siteInstructions: string(d.siteInstructions, 3000),
    methods: string(d.methods, 3000),
    equipment: string(d.equipment, 2000),
    people: (d.people as number | null) ?? null,
    crew: string(d.crew, 500),
    contractorInput: string(d.contractorInput, 3000),
    additional: string(d.additional, 3000),
    workingFolder: string(d.workingFolder, 1000),
    scheduleNotes: string(d.scheduleNotes, 1000),
    schedules: strings(d.schedules, 10, 160),
    tkList: strings(d.tkList, 30, 200),
    risks,
    otherRisks: string(d.otherRisks, 1000),
    ...(Object.keys(permitRisks).length ? { permitRisks } : {}),
  };
}
export function briefSnapshot(p: WorkProject): BriefSnapshot {
  return {
    documentType: p.documentType,
    developmentMode: p.developmentMode,
    objectName: p.objectName,
    objectAddress: p.objectAddress,
    customer: p.customer,
    responsible: p.responsible,
    workType: p.workType,
    baseTemplatePath: p.baseTemplatePath,
    scheduleSource: p.scheduleSource,
    usesTowerCrane: p.usesTowerCrane,
    hasMonolithicWork: p.hasMonolithicWork,
    hasWorkAtHeight: p.hasWorkAtHeight,
    hasLiftingStructures: p.hasLiftingStructures,
    brief: p.brief || readWorkBrief(undefined, p),
  };
}
export function isBriefApproved(task: Task, project: WorkProject) {
  const last = task.briefApprovals?.at(-1);
  return (
    !!last &&
    JSON.stringify(last.snapshot) === JSON.stringify(briefSnapshot(project))
  );
}
export function briefIssues(project: WorkProject) {
  const b = project.brief || readWorkBrief(undefined, project);
  try {
    readWorkBrief(b, project);
  } catch (e) {
    return [e instanceof Error ? e.message : 'Проверьте поля ТЗ.'];
  }
  return [
    !b.code && 'Укажите шифр документа.',
    !b.title && 'Укажите наименование документа.',
    !project.objectName.trim() && 'Укажите объект.',
    !project.workType.trim() && 'Укажите основной вид работ.',
    project.documentType === 'ppr' &&
      project.developmentMode === 'undecided' &&
      'Выберите ППР с ТК или без ТК.',
    project.documentType === 'ppr' &&
      project.developmentMode === 'with_tk' &&
      !b.tkList.length &&
      'Добавьте хотя бы одну ТК.',
  ].filter(Boolean) as string[];
}
export function briefWarnings(project: WorkProject) {
  const b = project.brief || readWorkBrief(undefined, project);
  return [
    !project.objectAddress && 'Уточнить адрес объекта.',
    !b.contractor.fullName && 'Уточнить подписанта Подрядчика.',
    !b.customer.fullName && 'Уточнить подписанта Заказчика.',
    (!b.contractor.authority || !b.customer.authority) &&
      'Проверить основания полномочий подписантов.',
    ...Object.entries(b.risks)
      .filter(([, state]) => state === 'unknown')
      .map(
        ([key]) =>
          `Уточнить риск: ${riskLabels[key as keyof typeof riskLabels]}.`,
      ),
  ].filter(Boolean) as string[];
}

// Paths are internal references; they are not part of the model input.
export function briefForAgent(project: WorkProject) {
  const { workingFolder: _workingFolder, ...brief } =
    project.brief || readWorkBrief(undefined, project);
  return {
    ...brief,
    ...(brief.permitRisks
      ? {
          permitRiskDescriptions: Object.fromEntries(
            Object.keys(brief.permitRisks).map((id) => [
              id,
              permitRiskLabels[id as PermitRiskId],
            ]),
          ),
        }
      : {}),
  };
}

export function readBriefApprovals(value: unknown): BriefApproval[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10)
    throw new Error('Неверный архив ТЗ.');
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const item = object(entry),
      snapshot = object(item.snapshot);
    if (
      typeof item.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(item.id) ||
      ids.has(item.id) ||
      item.version !== index + 1 ||
      typeof item.at !== 'string' ||
      Number.isNaN(Date.parse(item.at))
    )
      throw new Error('Неверная версия ТЗ.');
    ids.add(item.id);
    if (
      !['ppr', 'tk'].includes(String(snapshot.documentType)) ||
      !['undecided', 'with_tk', 'without_tk'].includes(
        String(snapshot.developmentMode),
      ) ||
      !['unknown', 'contractor', 'draft'].includes(
        String(snapshot.scheduleSource),
      )
    )
      throw new Error('Неверный снимок ТЗ.');
    const parsed = {
      ...snapshot,
      brief: readWorkBrief(snapshot.brief),
    } as unknown as WorkProject;
    for (const key of [
      'objectName',
      'objectAddress',
      'customer',
      'responsible',
      'workType',
      'baseTemplatePath',
    ] as const)
      parsed[key] = string(
        snapshot[key],
        key === 'baseTemplatePath' ? 1000 : 300,
      );
    for (const key of [
      'usesTowerCrane',
      'hasMonolithicWork',
      'hasWorkAtHeight',
      'hasLiftingStructures',
    ] as const) {
      if (typeof snapshot[key] !== 'boolean')
        throw new Error('Неверные условия ТЗ.');
      parsed[key] = snapshot[key];
    }
    return {
      id: item.id,
      version: index + 1,
      at: item.at,
      snapshot: briefSnapshot(parsed),
    };
  });
}
export function readTkAssignments(
  value: unknown,
  approvals: BriefApproval[],
): TkAssignment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 300)
    throw new Error('Неверный список заданий ТК.');
  const ids = new Set<string>();
  return value.map((entry) => {
    const item = object(entry);
    const approval = approvals.find(
      (a) => a.id === item.briefId && a.version === item.briefVersion,
    );
    if (
      !approval ||
      typeof item.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(item.id) ||
      ids.has(item.id) ||
      item.status !== 'prepared' ||
      item.executor !== 'tk_developer' ||
      typeof item.createdAt !== 'string' ||
      Number.isNaN(Date.parse(item.createdAt))
    )
      throw new Error('Неверное задание ТК.');
    ids.add(item.id);
    const title = string(item.title, 200);
    if (!approval.snapshot.brief.tkList.includes(title))
      throw new Error('ТК отсутствует в утверждённом задании.');
    return {
      id: item.id,
      title,
      briefId: approval.id,
      briefVersion: approval.version,
      createdAt: item.createdAt,
      status: 'prepared',
      executor: 'tk_developer',
    };
  });
}
