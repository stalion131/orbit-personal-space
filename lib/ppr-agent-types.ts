export type PprAgentSection = {
  title: string;
  treatment: 'keep' | 'expand' | 'reference' | 'conditional' | 'manual';
  rationale: string;
};

export type PprAgentHandoff = {
  target: 'ntd_specialist' | 'quality_controller' | 'autocad_specialist' | 'contractor';
  reason: string;
};

export type PprDeveloperResult = {
  overview: string;
  readiness: 'ready' | 'needs_data';
  sections: PprAgentSection[];
  missingInformation: string[];
  questions: string[];
  handoffs: PprAgentHandoff[];
  warnings: string[];
};
