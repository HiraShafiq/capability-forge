import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { startLegacyBank } from '../app/legacy-bank.js';
import { BrowserSurface } from '../surface/browser-surface.js';
import { createDecisionModel } from '../agent/model.js';
import { discover } from '../agent/discovery.js';
import { parseKeyValues, boolEnv } from './args.js';

const program = new Command()
  .name('discover')
  .description('Run genuine LLM-driven discovery against the live training UI')
  .option('--goal <goal>', 'Natural-language goal', 'Look up member M-1001 and return their current savings available balance')
  .option('--input <key=value...>', 'Typed capability input', ['memberId=M-1001'])
  .option('--tenant <tenant>', 'Tenant variant', 'harbor')
  .option('--port <port>', 'Training app port', '4310')
  .option('--headed', 'Show the discovery browser', false)
  .parse();

const opts = program.opts<{ goal: string; input: string[]; tenant: string; port: string; headed: boolean }>();
const inputs = parseKeyValues(opts.input);
const app = await startLegacyBank(Number(opts.port));
const surface = await BrowserSurface.launch({ headless: opts.headed ? false : boolEnv('HEADLESS', true) });

try {
  const result = await discover({
    surface, model: createDecisionModel(), goal: opts.goal,
    entryUrl: `${app.baseUrl}/tenant/${opts.tenant}`, inputs,
    evidenceRoot: 'evidence/discovery'
  });
  await mkdir('evidence/artifacts', { recursive: true });
  await writeFile('evidence/artifacts/member-savings-balance.v1.json', `${JSON.stringify(result.artifact, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'success', ...result, artifact: 'evidence/artifacts/member-savings-balance.v1.json' }, null, 2));
} finally {
  await surface.close(); await app.close();
}
