import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { CapabilitySchema } from '../core/schemas.js';
import { startLegacyBank } from '../app/legacy-bank.js';
import { BrowserSurface } from '../surface/browser-surface.js';
import { replay } from '../replay/replay-engine.js';
import { parseKeyValues, boolEnv } from './args.js';
import { ControlPlane } from '../handoff/control-plane.js';
import { startOperatorServer } from '../handoff/operator-server.js';

const program = new Command()
  .name('replay')
  .description('Replay a saved capability with no model in the loop')
  .option('--artifact <path>', 'Capability artifact', 'evidence/artifacts/member-savings-balance.v1.json')
  .option('--input <key=value...>', 'Typed capability input', ['memberId=M-2048'])
  .option('--variant <variant>', 'Tenant variant', 'harbor')
  .option('--scenario <scenario>', 'normal, approval, or timeout', 'normal')
  .option('--app-port <port>', 'Training app port', '4310')
  .option('--operator-port <port>', 'Operator console port', '4311')
  .option('--headed', 'Show the replay browser', false)
  .parse();

const opts = program.opts<{ artifact: string; input: string[]; variant: string; scenario: string; appPort: string; operatorPort: string; headed: boolean }>();
const capability = CapabilitySchema.parse(JSON.parse(await readFile(opts.artifact, 'utf8')));
const app = await startLegacyBank(Number(opts.appPort));
const surface = await BrowserSurface.launch({ headless: opts.headed ? false : boolEnv('HEADLESS', true) });
const control = new ControlPlane();
const operator = await startOperatorServer(control, Number(opts.operatorPort));

console.error(`Operator console: ${operator.url}`);
try {
  const result = await replay({
    capability, inputs: parseKeyValues(opts.input), surface, variant: opts.variant,
    entryUrlOverride: `${app.baseUrl}/tenant/${opts.variant}?scenario=${opts.scenario}`,
    evidenceRoot: 'evidence/replay', controlPlane: control
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'failure' ? 1 : 0;
} finally {
  await operator.close(); await surface.close(); await app.close();
}
