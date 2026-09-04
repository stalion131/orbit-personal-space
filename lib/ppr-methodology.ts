import type { WorkProject } from './tasks';

export type PprSectionTreatment = 'keep' | 'expand' | 'reference' | 'conditional' | 'manual';
export type PprSectionPlan = { id: string; title: string; treatment: PprSectionTreatment; note: string };
export type PprReadiness = { score: number; ready: boolean; missing: string[]; warnings: string[]; appliedRules: string[] };

export const pprModeLabels = {
  undecided: 'Режим ещё не выбран',
  with_tk: 'ППР с технологическими картами',
  without_tk: 'ППР без технологических карт',
} as const;

export const pprScheduleLabels = {
  unknown: 'Источник ещё не определён',
  contractor: 'Запрашиваем у подрядчика',
  draft: 'Разрабатываем укрупнённо',
} as const;

export function buildPprSectionPlan(project: WorkProject): PprSectionPlan[] {
  const technology = project.developmentMode === 'with_tk'
    ? { title: 'Технология производства работ: ссылки на ТК', treatment: 'reference' as const, note: 'Технологические процессы подробно раскрываются в отдельных ТК и не дублируются.' }
    : project.developmentMode === 'without_tk'
      ? { title: 'Технология производства работ', treatment: 'expand' as const, note: 'Технологию необходимо полностью раскрыть в разделе 5.' }
      : { title: 'Технология производства работ', treatment: 'conditional' as const, note: 'Состав раздела определится после выбора режима ППР.' };
  const scheduleNote = project.scheduleSource === 'contractor'
    ? 'Запросить согласованные графики у подрядчика и включить полученные данные.'
    : project.scheduleSource === 'draft'
      ? 'Подготовить укрупнённые графики и явно отметить исходные допущения.'
      : 'Определить: графики предоставляет подрядчик или их нужно разработать укрупнённо.';

  const sections: PprSectionPlan[] = [
    { id: 'general', title: '1. Общая часть', treatment: 'keep', note: 'Исходные сведения, объект, участники и основание разработки.' },
    { id: 'organization', title: '2. Мероприятия по производству работ', treatment: 'keep', note: 'Организация и последовательность выполнения работ.' },
    { id: 'resources', title: '3. Потребность в ресурсах', treatment: 'keep', note: 'Машины, персонал, инструмент, приспособления и средства защиты.' },
    { id: 'explanatory', title: '4. Пояснительная записка', treatment: 'keep', note: 'Условия площадки, временные сети, режим работ, хранение и опасные зоны.' },
    { id: 'technology', ...technology },
    { id: 'safety', title: '6. Охрана труда и промышленная безопасность', treatment: 'keep', note: 'Общие и применимые к выбранным работам меры безопасности.' },
    { id: 'ntd', title: '7. Перечень нормативной документации', treatment: 'reference', note: 'Состав и актуальность проверяет отдельный специалист по НТД.' },
    { id: 'schedules', title: 'Приложение. Графики производства и ресурсов', treatment: 'conditional', note: scheduleNote },
    { id: 'graphics', title: 'Приложение. Графическая часть / ситуационный план', treatment: 'manual', note: 'Разрабатывается вручную в AutoCAD; агент готовит только задание и перечень схем.' },
  ];
  if (project.hasWorkAtHeight || project.brief?.risks.height !== 'no') sections.push({ id: 'height', title: 'Приложение. План производства работ на высоте', treatment: 'conditional', note: project.hasWorkAtHeight ? 'Включается, поскольку отмечено наличие работ на высоте.' : 'Наличие работ на высоте не определено. Уточнить до решения о составе приложения.' });
  if (project.hasLiftingStructures || project.brief?.risks.lifting !== 'no') sections.push({ id: 'lifting', title: 'Приложение. План работ с применением подъёмных сооружений', treatment: 'conditional', note: project.hasLiftingStructures ? 'Включается, поскольку отмечено применение подъёмных сооружений.' : 'Применение подъёмных сооружений не определено. Уточнить до решения о составе приложения.' });
  if (project.usesTowerCrane) sections.push({ id: 'tower-crane', title: 'Ссылка на ППРк башенного крана', treatment: 'reference', note: 'Не разрабатывать крановый ППР повторно; запросить и указать утверждённый ППРк.' });
  return sections;
}

export function evaluatePprReadiness(project: WorkProject): PprReadiness {
  const checks = [
    Boolean(project.objectName.trim()), Boolean(project.objectAddress.trim()), Boolean(project.customer.trim()), Boolean(project.responsible.trim()),
    Boolean(project.workType.trim()), project.developmentMode !== 'undecided', Boolean(project.baseTemplatePath.trim()), project.scheduleSource !== 'unknown',
    project.documents.some(document => document.category === 'source' && ['available', 'review', 'approved'].includes(document.status)),
  ];
  const missing = [
    !project.workType.trim() && 'Укажите основной вид работ.',
    project.developmentMode === 'undecided' && 'Выберите: ППР с ТК или без ТК.',
    !project.objectName.trim() && 'Укажите наименование объекта.',
  ].filter(Boolean) as string[];
  const warnings = [
    !project.objectAddress.trim() && 'Не указан адрес объекта.',
    !project.customer.trim() && 'Не указан заказчик.',
    !project.responsible.trim() && 'Не указан ответственный.',
    !project.baseTemplatePath.trim() && 'Не выбран базовый шаблон.',
    project.scheduleSource === 'unknown' && 'Не определён источник графиков.',
    !project.documents.some(document => document.category === 'source' && ['available', 'review', 'approved'].includes(document.status)) && 'В реестре нет полученных исходных данных.',
  ].filter(Boolean) as string[];
  const appliedRules = [
    project.developmentMode === 'with_tk' ? 'Раздел 5 не дублирует технологию и ссылается на ТК.' : project.developmentMode === 'without_tk' ? 'Технология полностью раскрывается в разделе 5.' : 'Режим раздела 5 ещё не определён.',
    project.hasWorkAtHeight ? 'Нужен план производства работ на высоте.' : project.brief?.risks.height === 'no' ? 'Работы на высоте исключены в текущем ТЗ.' : 'Наличие работ на высоте требует уточнения; отсутствие не подтверждено.',
    project.hasLiftingStructures ? 'Нужен план с применением подъёмных сооружений.' : project.brief?.risks.lifting === 'no' ? 'Подъёмные сооружения исключены в текущем ТЗ.' : 'Применение подъёмных сооружений требует уточнения; отсутствие не подтверждено.',
    project.usesTowerCrane ? 'Нужна ссылка на утверждённый ППРк башенного крана.' : 'Ссылка на ППРк не требуется по текущим данным.',
    project.hasMonolithicWork ? 'Не выполнять расчёт опалубки и прогрева; дать только общие данные выбранного способа.' : 'Ограничения для монолитных работ не применены.',
    'Графическая часть остаётся ручной работой в AutoCAD.',
    'Все отличия от базового шаблона должны быть выделены синим.',
  ];
  return { score: Math.round(checks.filter(Boolean).length / checks.length * 100), ready: missing.length === 0, missing, warnings, appliedRules };
}
