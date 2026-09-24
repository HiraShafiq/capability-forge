import { ControlPlane } from '../handoff/control-plane.js';
import { startOperatorServer } from '../handoff/operator-server.js';

const operator = await startOperatorServer(new ControlPlane(), Number(process.env.OPERATOR_PORT ?? 4311));
console.log(`Standalone operator UI available at ${operator.url}. It will show an idle state until embedded in a replay process.`);
