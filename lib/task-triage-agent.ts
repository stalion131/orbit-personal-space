import 'server-only';

import { Agent, Runner } from '@openai/agents';
import { z } from 'zod';
import type { Catalog, Task } from './tasks';
import type { TriageResult } from './agent-types';

const proposalSchema = z.object({
  taskId: z.string(),
  nextAction: z.string(),
  suggestedPriority: z.enum(['low', 'medium', 'high', 'critical']),
  suggestedDueDate: z.string().nullable(),
  suggestedDurationMinutes: z.number().int(),
  focus: z.boolean(),
  reason: z.string(),
  clarifyingQuestion: z.string().nullable(),
});

const outputSchema = z.object({
  overview: z.string(),
  proposals: z.array(proposalSchema),
});

const instructions = `Ты — ИИ-разборщик задач в личном планировщике Orbit.
Твоя цель — превратить каждую неясную задачу в конкретное следующее действие и предложить разумные параметры планирования.

Правила:
- анализируй только переданные задачи и сохраняй их taskId без изменений;
- не придумывай личные факты, договорённости и внешние сроки;
- suggestedDueDate — дата YYYY-MM-DD только когда срок следует из текста или текущих данных, иначе null;
- suggestedDurationMinutes — реалистичная оценка от 5 до 1440 минут;
- critical означает MVP/критически важную задачу, high — важную, medium — обычную, low — низкую;
- focus=true только для максимум трёх задач, которыми действительно стоит заняться первыми;
- clarifyingQuestion заполняй только если без ответа пользователя нельзя разумно спланировать задачу;
- предложения не выполняются автоматически: пользователь отдельно решит, применять ли их;
- отвечай по-русски, коротко и конкретно.`;

export async function triageTasks(tasks: Task[], catalog: Catalog, today: string): Promise<TriageResult> {
  const model = process.env.OPENAI_AGENT_MODEL?.trim() || 'gpt-4o-mini';
  const agent = new Agent({ name: 'ИИ-разбор задач', instructions, model, outputType: outputSchema });
  const sphereNames = new Map(catalog.spheres.map(item => [item.id, item.name]));
  const directionNames = new Map(catalog.directions.map(item => [item.id, item.name]));
  const input = {
    today,
    timezone: 'Europe/Berlin',
    tasks: tasks.slice(0, 100).map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      sphere: sphereNames.get(task.sphere) || task.sphere,
      direction: task.directionId ? directionNames.get(task.directionId) || null : null,
      dueDate: task.dueDate,
      dueTime: task.dueTime || null,
      durationMinutes: task.durationMinutes || 60,
      priority: task.priority,
      focus: task.focus,
      status: task.status,
      waitingFor: task.waitingFor || null,
    })),
  };
  const runner = new Runner({
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
  });
  const result = await runner.run(agent, JSON.stringify(input), { maxTurns: 2 });
  if (!result.finalOutput) throw new Error('Agent returned no structured output');

  const taskById = new Map(tasks.map(task => [task.id, task]));
  const seen = new Set<string>();
  const proposals = result.finalOutput.proposals.flatMap(item => {
    const task = taskById.get(item.taskId);
    if (!task || seen.has(item.taskId)) return [];
    seen.add(item.taskId);
    const dueDate = item.suggestedDueDate && /^\d{4}-\d{2}-\d{2}$/.test(item.suggestedDueDate) ? item.suggestedDueDate : null;
    const duration = Math.max(5, Math.min(1440, Math.round(item.suggestedDurationMinutes / 5) * 5));
    return [{
      id: crypto.randomUUID(),
      taskId: task.id,
      taskRevision: task.revision,
      taskTitle: task.title,
      nextAction: item.nextAction.trim().slice(0, 500),
      suggestedPriority: item.suggestedPriority,
      suggestedDueDate: dueDate,
      suggestedDurationMinutes: duration,
      focus: item.focus,
      reason: item.reason.trim().slice(0, 500),
      clarifyingQuestion: item.clarifyingQuestion?.trim().slice(0, 500) || null,
    }];
  });
  let focusCount = 0;
  for (const proposal of proposals) {
    if (!proposal.focus) continue;
    focusCount += 1;
    if (focusCount > 3) proposal.focus = false;
  }
  return { overview: result.finalOutput.overview.trim().slice(0, 1000), proposals };
}
