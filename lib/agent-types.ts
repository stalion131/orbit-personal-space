import type { Priority } from './tasks';

export type AgentDescriptor = {
  id: 'task_triage_agent';
  name: string;
  description: string;
  status: 'ready' | 'setup_required';
};

export type TriageProposal = {
  id: string;
  taskId: string;
  taskRevision: number;
  taskTitle: string;
  nextAction: string;
  suggestedPriority: Priority;
  suggestedDueDate: string | null;
  suggestedDurationMinutes: number;
  focus: boolean;
  reason: string;
  clarifyingQuestion: string | null;
};

export type TriageResult = {
  overview: string;
  proposals: TriageProposal[];
};
