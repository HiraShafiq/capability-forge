import { mkdir, writeFile } from 'node:fs/promises';
import { startLegacyBank } from '../app/legacy-bank.js';
import { BrowserSurface } from '../surface/browser-surface.js';
import { ScriptedDecisionModel } from '../agent/model.js';
import { discover } from '../agent/discovery.js';
import { replay } from '../replay/replay-engine.js';

const app = await startLegacyBank(4310);
let surface = await BrowserSurface.launch({ headless: true });
try {
  console.log('1/3 Offline smoke discovery (explicitly non-qualifying as LLM evidence)');
  const discovered = await discover({ surface, model: new ScriptedDecisionModel(), goal: 'Look up member M-1001 and return their current savings available balance', entryUrl: `${app.baseUrl}/tenant/harbor`, inputs: { memberId: 'M-1001' }, evidenceRoot: 'evidence/runtime' });
  await mkdir('evidence/artifacts', { recursive: true });
  await writeFile('evidence/artifacts/member-savings-balance.v1.json', `${JSON.stringify(discovered.artifact, null, 2)}\n`);
  console.log(`    Artifact: evidence/artifacts/member-savings-balance.v1.json`);
  await surface.close();

  console.log('2/3 Deterministic success replay for a different member');
  surface = await BrowserSurface.launch({ headless: true });
  const success = await replay({ capability: discovered.artifact, inputs: { memberId: 'M-2048' }, surface, variant: 'summit', entryUrlOverride: `${app.baseUrl}/tenant/summit`, evidenceRoot: 'evidence/runtime' });
  console.log(`    ${success.status}: ${success.status === 'success' ? JSON.stringify(success.outputs) : ''}`);
  await surface.close();

  console.log('3/3 Deterministic expected business outcome');
  surface = await BrowserSurface.launch({ headless: true });
  const notFound = await replay({ capability: discovered.artifact, inputs: { memberId: 'M-9999' }, surface, variant: 'harbor', entryUrlOverride: `${app.baseUrl}/tenant/harbor`, evidenceRoot: 'evidence/runtime' });
  console.log(`    ${notFound.status}: ${notFound.status === 'business_outcome' ? notFound.code : ''}`);
} finally {
  await surface.close().catch(() => undefined); await app.close();
}
