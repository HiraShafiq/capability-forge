import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { redactObject } from '../utils/redact.js';

export interface RunEvent {
  at: string;
  runId: string;
  phase: 'discovery' | 'replay' | 'handoff';
  type: string;
  stepId?: string;
  rationale?: string;
  data?: Record<string, unknown>;
}

export class EvidenceRecorder {
  readonly directory: string;
  readonly logPath: string;

  constructor(readonly runId: string, phase: RunEvent['phase'], root = 'evidence/runtime') {
    this.directory = join(root, `${phase}-${runId}`);
    this.logPath = join(this.directory, 'events.jsonl');
  }

  async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true }); }

  async event(event: Omit<RunEvent, 'at' | 'runId'>): Promise<void> {
    await this.initialize();
    const line = JSON.stringify(redactObject({ at: new Date().toISOString(), runId: this.runId, ...event }));
    await appendFile(this.logPath, `${line}\n`, 'utf8');
  }

  async writeJson(filename: string, value: unknown): Promise<string> {
    const path = join(this.directory, filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(redactObject(value), null, 2)}\n`, 'utf8');
    return path;
  }

  path(filename: string): string { return join(this.directory, filename); }
}
