import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startLegacyBank } from '../src/app/legacy-bank.js';
import { BrowserSurface } from '../src/surface/browser-surface.js';
import { ScriptedDecisionModel } from '../src/agent/model.js';
import { discover } from '../src/agent/discovery.js';
import { replay } from '../src/replay/replay-engine.js';
import { ControlPlane } from '../src/handoff/control-plane.js';

describe('end-to-end vertical slice', () => {
  let closeApp: () => Promise<void>;
  const baseUrl = 'http://127.0.0.1:4390';
  let surfaces: BrowserSurface[] = [];

  beforeEach(async () => { const app = await startLegacyBank(4390); closeApp = app.close; });
  afterEach(async () => { await Promise.all(surfaces.map((surface) => surface.close().catch(() => undefined))); surfaces = []; await closeApp(); });

  async function surface() { const value = await BrowserSurface.launch({ headless: true }); surfaces.push(value); return value; }
  async function capability() {
    return (await discover({ surface: await surface(), model: new ScriptedDecisionModel(), goal: 'Look up member M-1001 and return their current savings available balance', entryUrl: `${baseUrl}/tenant/harbor`, inputs: { memberId: 'M-1001' }, evidenceRoot: 'test-results/evidence' })).artifact;
  }

  it('discovers once, then replays without a model on another tenant variant', async () => {
    const saved = await capability();
    const result = await replay({ capability: saved, inputs: { memberId: 'M-2048' }, surface: await surface(), variant: 'summit', evidenceRoot: 'test-results/evidence' });
    expect(result).toMatchObject({ status: 'success', outputs: { savingsBalance: 25004.01 } });
  });

  it('returns member-not-found as a business outcome, not a crash', async () => {
    const saved = await capability();
    const result = await replay({ capability: saved, inputs: { memberId: 'M-9999' }, surface: await surface(), variant: 'harbor', evidenceRoot: 'test-results/evidence' });
    expect(result).toMatchObject({ status: 'business_outcome', code: 'MEMBER_NOT_FOUND' });
  });

  it('stops with a debuggable failure when a known condition cannot be escalated', async () => {
    const saved = await capability();
    const result = await replay({ capability: saved, inputs: { memberId: 'M-1001' }, surface: await surface(), variant: 'harbor', entryUrlOverride: `${baseUrl}/tenant/harbor?scenario=timeout`, evidenceRoot: 'test-results/evidence' });
    expect(result).toMatchObject({ status: 'failure', error: { code: 'INTERVENTION_UNAVAILABLE', stepId: 'step-02' } });
  });

  it('validates typed inputs before the first navigation', async () => {
    const saved = await capability();
    const result = await replay({ capability: saved, inputs: { memberId: 'not-a-member' }, surface: await surface(), variant: 'harbor', evidenceRoot: 'test-results/evidence' });
    expect(result).toMatchObject({ status: 'failure', error: { code: 'INPUT_VALIDATION' } });
  });

  it('cedes the live session to a human and resumes after the blocking state is resolved', async () => {
    const saved = await capability();
    const browser = await surface();
    const control = new ControlPlane();
    control.once('requested', async () => {
      control.takeControl('test-operator');
      const observation = await browser.observe();
      const button = observation.interactiveElements.find((item) => item.name === 'Supervisor reviewed');
      if (!button?.box) throw new Error('Supervisor button not observable');
      await control.click('test-operator', button.box.x + button.box.width / 2, button.box.y + button.box.height / 2);
      control.resumeAutomation('test-operator', 'Reviewed training-only supervisor gate');
    });
    const result = await replay({ capability: saved, inputs: { memberId: 'M-1001' }, surface: browser, variant: 'harbor', entryUrlOverride: `${baseUrl}/tenant/harbor?scenario=approval`, evidenceRoot: 'test-results/evidence', controlPlane: control, interventionTimeoutMs: 5_000 });
    expect(result).toMatchObject({ status: 'success', outputs: { savingsBalance: 12750.44 } });
    expect(control.current?.actions.map((item) => item.action)).toEqual(['take_control', 'click', 'resume_automation']);
  });
});
