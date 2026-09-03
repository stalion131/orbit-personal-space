import 'server-only';

import { Agent, Runner } from '@openai/agents';
import { z } from 'zod';
import type { PprDeveloperResult } from './ppr-agent-types';
import { buildPprSectionPlan, evaluatePprReadiness } from './ppr-methodology';
import type { Task, WorkProject } from './tasks';

const outputSchema = z.object({
  overview: z.string(),
  readiness: z.enum(['ready', 'needs_data']),
  sections: z.array(z.object({
    title: z.string(),
    treatment: z.enum(['keep', 'expand', 'reference', 'conditional', 'manual']),
    rationale: z.string(),
  })),
  missingInformation: z.array(z.string()),
  questions: z.array(z.string()),
  handoffs: z.array(z.object({
    target: z.enum(['ntd_specialist', 'quality_controller', 'autocad_specialist', 'contractor']),
    reason: z.string(),
  })),
  warnings: z.array(z.string()),
});

const instructions = `Ты — узкий профессиональный агент «Разработчик ППР» в системе Orbit.

Твоя единственная роль — подготовить карту разработки выбранного проекта производства работ по переданному паспорту и внутренней методике. Ты не являешься универсальным помощником.

Что нужно делать:
- оценить, хватает ли исходных данных для начала разработки;
- подтвердить обработку постоянных и условных разделов из переданной детерминированной карты;
- сформулировать короткие конкретные вопросы по недостающим данным;
- отметить, какие вопросы нужно передать другой профессиональной роли.

Жёсткие границы:
- не утверждай соответствие СП, ГОСТ и другим НТД и не придумывай нормативные требования или номера пунктов;
- нормативные вопросы передавай ntd_specialist;
- не создавай и не описывай как готовые графические схемы: передавай их autocad_specialist;
- не выполняй расчёты опалубки и прогрева бетона; для монолита указывай только необходимость общих данных выбранного способа;
- при башенном кране требуй ссылку на существующий утверждённый ППРк, но не разрабатывай ППРк;
- если графики или исходные данные должен предоставить подрядчик, используй handoff contractor;
- не изменяй структуру задачи, сроки и документы;
- не пиши полный текст ППР на этом этапе;
- отвечай по-русски, без предположений, выдаваемых за факты.

Поле sections должно следовать переданной карте Orbit. Поле readiness ставь ready только когда нет блокирующих missing из детерминированной проверки.`;

function cleanList(values: string[], maximum: number, limit: number) {
  return values.map(value => value.trim().slice(0, limit)).filter(Boolean).slice(0, maximum);
}

export async function analyzePprProject(task: Task, project: WorkProject): Promise<PprDeveloperResult> {
  const model = process.env.OPENAI_AGENT_MODEL?.trim() || 'gpt-4o-mini';
  const sectionPlan = buildPprSectionPlan(project);
  const readiness = evaluatePprReadiness(project);
  const input = {
    task: { title: task.title, description: task.description, dueDate: task.dueDate },
    project: {
      objectName: project.objectName, objectAddress: project.objectAddress, customer: project.customer, responsible: project.responsible,
      workType: project.workType, developmentMode: project.developmentMode, baseTemplatePath: project.baseTemplatePath, scheduleSource: project.scheduleSource,
      hasWorkAtHeight: project.hasWorkAtHeight, hasLiftingStructures: project.hasLiftingStructures, usesTowerCrane: project.usesTowerCrane, hasMonolithicWork: project.hasMonolithicWork,
      documents: project.documents.map(document => ({ name: document.name, category: document.category, status: document.status, version: document.version })),
    },
    deterministicReadiness: readiness,
    deterministicSectionPlan: sectionPlan,
  };
  const agent = new Agent({ name: 'Разработчик ППР', instructions, model, outputType: outputSchema });
  const runner = new Runner({ tracingDisabled: true, traceIncludeSensitiveData: false });
  const result = await runner.run(agent, JSON.stringify(input), { maxTurns: 2 });
  if (!result.finalOutput) throw new Error('PPR developer returned no structured output');
  const output = result.finalOutput;
  const outputSections = new Map(output.sections.map(section => [section.title.trim().toLocaleLowerCase('ru'), section]));
  const requiredHandoffs: PprDeveloperResult['handoffs'] = [
    { target: 'ntd_specialist', reason: 'Проверить актуальность и применимость нормативных документов перед выпуском.' },
    { target: 'autocad_specialist', reason: 'Подготовить графическую часть и ситуационный план вручную в AutoCAD.' },
    { target: 'quality_controller', reason: 'Проверить собранный документ перед передачей на согласование.' },
  ];
  if (project.scheduleSource !== 'draft' || readiness.missing.length || readiness.warnings.length) {
    requiredHandoffs.push({ target: 'contractor', reason: 'Получить или уточнить отсутствующие исходные данные и графики.' });
  }
  const handoffs = [...requiredHandoffs, ...output.handoffs.map(item => ({ target: item.target, reason: item.reason.trim().slice(0, 500) }))]
    .filter(item => item.reason).filter((item, index, all) => all.findIndex(candidate => candidate.target === item.target) === index).slice(0, 12);
  return {
    overview: output.overview.trim().slice(0, 1000),
    readiness: readiness.ready && output.readiness === 'ready' ? 'ready' : 'needs_data',
    sections: sectionPlan.map(section => {
      const agentSection = outputSections.get(section.title.toLocaleLowerCase('ru'));
      return { title: section.title, treatment: section.treatment, rationale: agentSection?.rationale.trim().slice(0, 500) || section.note };
    }),
    missingInformation: cleanList([...readiness.missing, ...output.missingInformation], 20, 300).filter((value, index, all) => all.indexOf(value) === index),
    questions: cleanList(output.questions, 15, 400),
    handoffs,
    warnings: cleanList([...readiness.warnings, ...output.warnings], 16, 400).filter((value, index, all) => all.indexOf(value) === index),
  };
}
