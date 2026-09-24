import { startLegacyBank } from '../app/legacy-bank.js';
import { ControlPlane } from '../handoff/control-plane.js';
import { startOperatorServer } from '../handoff/operator-server.js';

const app = await startLegacyBank(Number(process.env.APP_PORT ?? 4310));
const operator = await startOperatorServer(new ControlPlane(), Number(process.env.OPERATOR_PORT ?? 4311));
console.log(`Legacy banking UI: ${app.baseUrl}/tenant/harbor`);
console.log(`Tenant variant: ${app.baseUrl}/tenant/summit`);
console.log(`Operator console: ${operator.url}`);
console.log('Press Ctrl+C to stop.');

async function stop() { await operator.close(); await app.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
