import { EventEmitter } from 'node:events';
import type { BrowserSurface } from '../surface/browser-surface.js';
import type { InterventionRequest } from '../core/schemas.js';
import { newId } from '../utils/ids.js';
import type { EvidenceRecorder } from '../observability/evidence.js';

export class ControlPlane extends EventEmitter {
  private request: InterventionRequest | undefined;
  private surface: BrowserSurface | undefined;
  private resume: (() => void) | undefined;

  get current(): InterventionRequest | undefined { return this.request ? structuredClone(this.request) : undefined; }

  async requestAndWait(options: {
    runId: string;
    capabilityId: string;
    stepId?: string;
    reason: string;
    surface: BrowserSurface;
    evidence: EvidenceRecorder;
    timeoutMs?: number;
  }): Promise<void> {
    if (this.request && !['resumed', 'cancelled'].includes(this.request.state)) throw new Error('Another intervention is already active');
    const screenshotPath = options.evidence.path(`intervention-${Date.now()}.png`);
    await options.surface.screenshot(screenshotPath);
    this.surface = options.surface;
    this.request = {
      id: newId('intervention'), runId: options.runId, capabilityId: options.capabilityId,
      ...(options.stepId ? { stepId: options.stepId } : {}),
      reason: options.reason, state: 'requested', owner: 'none', createdAt: new Date().toISOString(), screenshotPath,
      actions: []
    };
    await options.evidence.event({ phase: 'handoff', type: 'intervention_requested', ...(options.stepId ? { stepId: options.stepId } : {}), data: { interventionId: this.request.id, reason: options.reason } });
    this.emit('requested', this.current);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.resume = undefined;
        reject(new Error(`Human intervention timed out after ${options.timeoutMs ?? 120_000}ms`));
      }, options.timeoutMs ?? 120_000);
      this.resume = () => { clearTimeout(timer); resolve(); };
    });
    await options.evidence.writeJson('intervention.json', this.request);
    this.surface = undefined;
  }

  takeControl(actor: string): InterventionRequest {
    if (!this.request || this.request.state !== 'requested') throw new Error('No intervention is waiting');
    this.request.state = 'human_in_control';
    this.request.owner = 'human';
    this.record(actor, 'take_control', {});
    return this.current!;
  }

  async screenshot(path: string): Promise<void> {
    if (!this.request || !['requested', 'human_in_control'].includes(this.request.state) || !this.surface) throw new Error('No live intervention session is available');
    await this.surface!.screenshot(path);
  }

  async click(actor: string, x: number, y: number): Promise<void> {
    this.assertHumanControl();
    await this.surface!.clickCoordinates(x, y);
    this.record(actor, 'click', { x, y });
  }

  async type(actor: string, value: string): Promise<void> {
    this.assertHumanControl();
    await this.surface!.typeRaw(value);
    this.record(actor, 'type', { length: value.length, value: '[REDACTED]' });
  }

  resumeAutomation(actor: string, note = ''): InterventionRequest {
    this.assertHumanControl();
    this.record(actor, 'resume_automation', { note });
    this.request!.state = 'resumed';
    this.request!.owner = 'automation';
    const snapshot = this.current!;
    this.resume?.();
    this.resume = undefined;
    this.emit('resumed', snapshot);
    return snapshot;
  }

  private record(actor: string, action: string, detail: Record<string, unknown>): void {
    this.request!.actions.push({ at: new Date().toISOString(), actor, action, detail });
  }

  private assertHumanControl(): void {
    if (!this.request || this.request.state !== 'human_in_control' || this.request.owner !== 'human' || !this.surface) {
      throw new Error('The human does not own an active session');
    }
  }
}
