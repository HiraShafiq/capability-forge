import { z } from 'zod';

export const ValueTypeSchema = z.enum(['string', 'number', 'boolean']);
export type ValueType = z.infer<typeof ValueTypeSchema>;

export const ParameterSchema = z.object({
  type: ValueTypeSchema,
  description: z.string(),
  required: z.boolean().default(true),
  sensitive: z.boolean().default(false),
  pattern: z.string().optional()
});

export const LocatorSchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('role'), role: z.string(), name: z.string().optional(), exact: z.boolean().default(true) }),
  z.object({ strategy: z.literal('label'), label: z.string(), exact: z.boolean().default(true) }),
  z.object({ strategy: z.literal('text'), text: z.string(), exact: z.boolean().default(true) }),
  z.object({ strategy: z.literal('css'), selector: z.string() }),
  z.object({ strategy: z.literal('coordinate'), x: z.number().nonnegative(), y: z.number().nonnegative(), viewport: z.object({ width: z.number(), height: z.number() }) })
]);
export type Locator = z.infer<typeof LocatorSchema>;

export const TargetSchema = z.object({
  description: z.string(),
  locators: z.array(LocatorSchema).min(1),
  minimumMatches: z.number().int().min(1).default(1),
  maximumMatches: z.number().int().min(1).default(1)
});

export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('navigate'), url: z.string(), risk: z.literal('safe'), checkpoint: z.string().optional() }),
  z.object({ id: z.string(), kind: z.literal('click'), target: TargetSchema, risk: z.enum(['safe', 'risky', 'irreversible']), checkpoint: z.string().optional() }),
  z.object({ id: z.string(), kind: z.literal('type'), target: TargetSchema, value: z.string(), clear: z.boolean().default(true), risk: z.enum(['safe', 'risky']), checkpoint: z.string().optional() }),
  z.object({ id: z.string(), kind: z.literal('extract'), target: TargetSchema, output: z.string(), parseAs: ValueTypeSchema, risk: z.literal('safe'), checkpoint: z.string().optional() }),
  z.object({ id: z.string(), kind: z.literal('wait'), milliseconds: z.number().int().min(0).max(10_000), risk: z.literal('safe'), checkpoint: z.string().optional() })
]);
export type Action = z.infer<typeof ActionSchema>;

export const OutcomeRuleSchema = z.object({
  code: z.string(),
  description: z.string(),
  when: TargetSchema,
  status: z.literal('business_outcome')
});

export const RecoveryRuleSchema = z.object({
  code: z.string(),
  description: z.string(),
  when: TargetSchema,
  action: z.enum(['retry_step', 'dismiss', 'escalate']),
  maxAttempts: z.number().int().min(0).max(3).default(1),
  dismissTarget: TargetSchema.optional()
});

export const CapabilitySchema = z.object({
  schemaVersion: z.literal('1.0'),
  capability: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    version: z.string(),
    status: z.enum(['draft', 'approved']).default('draft'),
    createdAt: z.string(),
    sourceRunId: z.string(),
    appFamily: z.string(),
    testedVariants: z.array(z.string()).default([])
  }),
  contract: z.object({
    inputs: z.record(z.string(), ParameterSchema),
    outputs: z.record(z.string(), ParameterSchema),
    possibleOutcomes: z.array(z.string())
  }),
  policy: z.object({
    allowedOrigins: z.array(z.string()).min(1),
    allowedPathPatterns: z.array(z.string()).min(1),
    allowedActions: z.array(z.enum(['navigate', 'click', 'type', 'extract', 'wait'])),
    riskyActionHandling: z.enum(['block', 'confirm', 'escalate']),
    persistSensitiveValues: z.literal(false)
  }),
  steps: z.array(ActionSchema).min(1),
  success: z.object({
    description: z.string(),
    checkpoint: TargetSchema
  }),
  businessOutcomes: z.array(OutcomeRuleSchema).default([]),
  recoveries: z.array(RecoveryRuleSchema).default([]),
  variants: z.record(z.string(), z.object({
    baseUrl: z.string(),
    locatorOverrides: z.record(z.string(), TargetSchema).default({})
  })).default({})
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const ObservationSchema = z.object({
  url: z.string(),
  title: z.string(),
  visibleText: z.string(),
  interactiveElements: z.array(z.object({
    ref: z.string(),
    role: z.string(),
    name: z.string(),
    tag: z.string(),
    disabled: z.boolean(),
    value: z.string().optional(),
    box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable()
  }))
});
export type Observation = z.infer<typeof ObservationSchema>;

export const AgentDecisionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('act'), rationale: z.string(), action: z.enum(['click', 'type', 'wait']), elementRef: z.string().optional(), value: z.string().optional() }),
  z.object({ type: z.literal('extract'), rationale: z.string(), elementRef: z.string(), outputName: z.string(), parseAs: ValueTypeSchema }),
  z.object({ type: z.literal('complete'), rationale: z.string(), successText: z.string() }),
  z.object({ type: z.literal('escalate'), rationale: z.string(), reason: z.string() })
]);
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export const RunResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), runId: z.string(), capabilityId: z.string(), outputs: z.record(z.string(), z.unknown()), durationMs: z.number() }),
  z.object({ status: z.literal('business_outcome'), runId: z.string(), capabilityId: z.string(), code: z.string(), message: z.string(), durationMs: z.number() }),
  z.object({ status: z.literal('failure'), runId: z.string(), capabilityId: z.string(), error: z.object({ code: z.string(), message: z.string(), stepId: z.string().optional(), expected: z.string().optional(), observed: z.string().optional(), evidencePath: z.string().optional() }), durationMs: z.number() })
]);
export type RunResult = z.infer<typeof RunResultSchema>;

export type ControlOwner = 'automation' | 'human' | 'none';

export interface InterventionRequest {
  id: string;
  runId: string;
  capabilityId: string;
  stepId?: string;
  reason: string;
  state: 'requested' | 'human_in_control' | 'resumed' | 'cancelled';
  owner: ControlOwner;
  createdAt: string;
  screenshotPath?: string;
  actions: Array<{ at: string; actor: string; action: string; detail: Record<string, unknown> }>;
}
