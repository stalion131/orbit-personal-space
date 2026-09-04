import { z } from 'zod';
import type { WorkProject } from './tasks';
import type { WorkBrief } from './work-brief';
import type { SourcePurpose } from './work-sources';

export const PPR_MODEL = 'gpt-5.6-sol';
export const fieldLabels = {
  objectName: 'Объект',
  objectAddress: 'Адрес объекта',
  workType: 'Основной вид работ',
  'brief.title': 'Наименование ППР',
  'brief.code': 'Шифр',
  'brief.contractor.organization': 'Подрядчик',
  'brief.contractor.position': 'Должность утверждающего',
  'brief.contractor.fullName': 'ФИО утверждающего',
  'brief.contractor.authority': 'Основание полномочий подрядчика',
  'brief.customer.organization': 'Заказчик',
  'brief.customer.position': 'Должность согласующего',
  'brief.customer.fullName': 'ФИО согласующего',
  'brief.customer.authority': 'Основание полномочий заказчика',
  'brief.siteInstructions': 'Организация стройплощадки',
  'brief.methods': 'Методы выполнения работ',
  'brief.equipment': 'Техника',
  'brief.people': 'Количество человек',
  'brief.crew': 'Состав бригады',
  'brief.contractorInput': 'Вводные подрядчика',
  'brief.additional': 'Дополнительные указания',
  'brief.scheduleNotes': 'Графики',
  'brief.otherRisks': 'Другие риски',
  'brief.risks.height': 'Работы на высоте',
  'brief.risks.lifting': 'Подъёмные сооружения',
  'brief.risks.fire': 'Огневые работы',
  'brief.risks.electrical': 'Электроустановки',
  'brief.risks.confined': 'Замкнутые пространства',
} as const;
export type BriefField = keyof typeof fieldLabels;
export const proposalSchema = z.object({
  field: z.enum(Object.keys(fieldLabels) as [BriefField, ...BriefField[]]),
  value: z.string(),
  fileHash: z.string(),
  blockId: z.string(),
  quote: z.string(),
  reason: z.string(),
});
export const extractionSchema = z.object({
  proposals: z.array(proposalSchema),
  questions: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type FieldProposal = z.infer<typeof proposalSchema>;
export type TextBlock = { id: string; text: string };
export type FileInfo = {
  hash: string;
  name: string;
  size: number;
  characters: number;
  purpose?: SourcePurpose;
};
export type BriefAnalysis = {
  id: string;
  at: string;
  revision: number;
  model: string;
  files: FileInfo[];
  proposals: FieldProposal[];
  questions: string[];
  warnings: string[];
  applied: string[];
};
export type WordVersion = {
  id: string;
  hash: string;
  name: string;
  at: string;
  parentHash: string;
  kind: 'assembled' | 'corrected';
  briefId: string;
  draftIds: string[];
};
export type TextChange = { before: string; after: string };
export type Experience = {
  id: string;
  versionId: string;
  at: string;
  changes: TextChange[];
  rule: string;
  confirmedAt: string | null;
};
export type PprWorkspace = {
  analyses: BriefAnalysis[];
  versions: WordVersion[];
  experience: Experience[];
};
export const emptyWorkspace = (): PprWorkspace => ({
  analyses: [],
  versions: [],
  experience: [],
});

// Keep bounded data across JSON import/export and reject malformed persisted histories.
export function readPprWorkspace(value: unknown): PprWorkspace {
  if (value === undefined) return emptyWorkspace();
  const text = z.string().max(3000),
    hash = z.string().regex(/^[a-f0-9]{64}$/),
    id = z.uuid();
  return z
    .object({
      analyses: z
        .array(
          z.object({
            id,
            at: z.iso.datetime(),
            revision: z.number().int().positive(),
            model: z.literal(PPR_MODEL),
            files: z
              .array(
                z.object({
                  hash,
                  name: text.max(200),
                  size: z.number().int().positive(),
                  characters: z.number().int().nonnegative(),
                  purpose: z
                    .enum([
                      'unspecified',
                      'construction_contract',
                      'ppr_contract',
                      'quantities',
                      'other',
                    ])
                    .optional(),
                }),
              )
              .max(8),
            proposals: z
              .array(
                proposalSchema.extend({
                  value: text,
                  quote: text.max(800),
                  reason: text.max(500),
                  fileHash: hash,
                  blockId: text.max(80),
                }),
              )
              .max(28),
            questions: z.array(text.max(500)).max(15),
            warnings: z.array(text.max(500)).max(15),
            applied: z.array(z.string()).max(28),
          }),
        )
        .max(10),
      versions: z
        .array(
          z.object({
            id,
            hash,
            name: text.max(200),
            at: z.iso.datetime(),
            parentHash: hash,
            kind: z.enum(['assembled', 'corrected']),
            briefId: id,
            draftIds: z.array(id).max(20),
          }),
        )
        .max(40),
      experience: z
        .array(
          z.object({
            id,
            versionId: id,
            at: z.iso.datetime(),
            changes: z.array(z.object({ before: text, after: text })).max(40),
            rule: text.max(1500),
            confirmedAt: z.iso.datetime().nullable(),
          }),
        )
        .max(40),
    })
    .parse(value);
}

export function fieldValue(
  project: WorkProject,
  brief: WorkBrief,
  field: BriefField,
): string {
  let current: unknown = field.startsWith('brief.') ? brief : project;
  for (const key of field.replace(/^brief\./, '').split('.'))
    current = (current as Record<string, unknown>)?.[key];
  return typeof current === 'string'
    ? current
    : typeof current === 'number'
      ? String(current)
      : '';
}

export function applyProposals(
  project: WorkProject,
  brief: WorkBrief,
  proposals: FieldProposal[],
): WorkProject {
  const result = structuredClone({ ...project, brief });
  for (const proposal of proposals) {
    if (!(proposal.field in fieldLabels))
      throw new Error('Поле ТЗ недоступно для заполнения.');
    const parts = proposal.field.split('.');
    let target = result as unknown as Record<string, unknown>;
    for (const key of parts.slice(0, -1))
      target = target[key] as Record<string, unknown>;
    const key = parts.at(-1)!;
    if (proposal.field === 'brief.people') {
      if (
        !/^\d+$/.test(proposal.value) ||
        Number(proposal.value) < 1 ||
        Number(proposal.value) > 100000
      )
        throw new Error('Некорректная численность.');
      target[key] = Number(proposal.value);
    } else {
      if (
        proposal.field.startsWith('brief.risks.') &&
        !['yes', 'no', 'unknown'].includes(proposal.value)
      )
        throw new Error('Некорректное значение риска.');
      target[key] = proposal.value;
    }
  }
  result.customer = result.brief.customer.organization;
  result.hasWorkAtHeight = result.brief.risks.height === 'yes';
  result.hasLiftingStructures = result.brief.risks.lifting === 'yes';
  return result;
}

export function verifiedProposals(
  proposals: FieldProposal[],
  files: { hash: string; blocks: TextBlock[]; purpose?: SourcePurpose }[],
) {
  const seen = new Set<string>();
  return proposals
    .filter((p) => {
      const file = files.find((f) => f.hash === p.fileHash);
      // A developer's contract is not evidence for construction-party signatories.
      if (
        file?.purpose === 'ppr_contract' &&
        /^brief\.(customer|contractor)\./.test(p.field)
      )
        return false;
      const source = files
        .find((f) => f.hash === p.fileHash)
        ?.blocks.find((b) => b.id === p.blockId);
      if (
        seen.has(p.field) ||
        !source ||
        !p.quote.trim() ||
        p.quote.length > 800 ||
        !source.text.includes(p.quote) ||
        p.value.length > 3000 ||
        p.reason.length > 500
      )
        return false;
      seen.add(p.field);
      return true;
    })
    .slice(0, 28);
}

export function confirmedExperience(workspace?: PprWorkspace) {
  return (workspace?.experience || [])
    .filter((e) => e.confirmedAt)
    .slice(-8)
    .map((e) => ({ rule: e.rule, examples: e.changes.slice(0, 3) }));
}
