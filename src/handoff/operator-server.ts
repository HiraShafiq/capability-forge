import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ControlPlane } from './control-plane.js';

const page = `<!doctype html><html><head><title>Operator Intervention Console</title><style>
body{margin:0;background:#0d1726;color:#e9eef5;font:14px system-ui}.bar{padding:14px 20px;background:#16253a;display:flex;gap:14px;align-items:center}.bar b{font-size:17px}.status{padding:4px 8px;border-radius:4px;background:#5b6470}button{padding:8px 14px;border:0;border-radius:4px;background:#4f8cff;color:white;font-weight:600}button:disabled{opacity:.4}.main{display:grid;grid-template-columns:1fr 320px;gap:18px;padding:18px}.screen{background:#05080d;border:1px solid #34435a;min-height:500px;text-align:center}.screen img{max-width:100%;cursor:crosshair}.panel{background:#16253a;padding:16px;border-radius:6px}.panel h3{margin-top:0}.reason{background:#351f25;border-left:4px solid #e27788;padding:10px}textarea{width:100%;box-sizing:border-box;background:#0d1726;color:white;border:1px solid #4b5a70;padding:8px}pre{white-space:pre-wrap;font-size:11px;color:#b8c7da}
</style></head><body><div class="bar"><b>Human Intervention Console</b><span class="status" id="status">waiting</span><button id="take">Take control</button><button id="resume" disabled>Resume automation</button></div><div class="main"><div class="screen"><img id="screen" alt="Live automation session"></div><div class="panel"><h3>Intervention</h3><div class="reason" id="reason">No active intervention</div><p>Click the screenshot to operate the same browser session. Keyboard input is sent through the box below.</p><textarea id="typing" rows="3" placeholder="Type into the focused control"></textarea><button id="send" disabled>Send keys</button><h3>Audit trail</h3><pre id="audit"></pre></div></div><script>
const statusEl=document.querySelector('#status'), reason=document.querySelector('#reason'), screen=document.querySelector('#screen'), take=document.querySelector('#take'), resume=document.querySelector('#resume'), send=document.querySelector('#send'), typing=document.querySelector('#typing'), audit=document.querySelector('#audit');
let current;
async function refresh(){const r=await fetch('/api/intervention');current=await r.json();statusEl.textContent=current.state||'waiting';reason.textContent=current.reason||'No active intervention';audit.textContent=JSON.stringify(current.actions||[],null,2);const human=current.owner==='human';take.disabled=!current.id||current.state!=='requested';resume.disabled=!human;send.disabled=!human;if(current.id)screen.src='/api/intervention/screenshot?t='+Date.now();}
take.onclick=async()=>{await fetch('/api/intervention/take-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:'operator@example.com'})});refresh()};
resume.onclick=async()=>{await fetch('/api/intervention/resume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:'operator@example.com',note:'Reviewed blocking state and completed permitted manual action'})});refresh()};
send.onclick=async()=>{await fetch('/api/intervention/type',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:'operator@example.com',value:typing.value})});typing.value='';refresh()};
screen.onclick=async(e)=>{if(!current||current.owner!=='human')return;const rect=screen.getBoundingClientRect();const x=(e.clientX-rect.left)*(screen.naturalWidth/rect.width),y=(e.clientY-rect.top)*(screen.naturalHeight/rect.height);await fetch('/api/intervention/click',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:'operator@example.com',x,y})});setTimeout(refresh,250)};
setInterval(refresh,1000);refresh();
</script></body></html>`;

export function createOperatorApp(control: ControlPlane): Express {
  const app = express(); app.use(express.json());
  app.get('/', (_req, res) => res.type('html').send(page));
  app.get('/api/intervention', (_req, res) => res.json(control.current ?? { state: 'waiting', owner: 'none', actions: [] }));
  app.get('/api/intervention/screenshot', async (_req, res, next) => {
    try { const path = join(tmpdir(), 'interface-ai-operator-current.png'); await control.screenshot(path); res.sendFile(path); } catch (error) { next(error); }
  });
  app.post('/api/intervention/take-control', (req, res, next) => { try { res.json(control.takeControl(String(req.body.actor ?? 'operator'))); } catch (error) { next(error); } });
  app.post('/api/intervention/click', async (req, res, next) => { try { await control.click(String(req.body.actor ?? 'operator'), Number(req.body.x), Number(req.body.y)); res.json({ ok: true }); } catch (error) { next(error); } });
  app.post('/api/intervention/type', async (req, res, next) => { try { await control.type(String(req.body.actor ?? 'operator'), String(req.body.value ?? '')); res.json({ ok: true }); } catch (error) { next(error); } });
  app.post('/api/intervention/resume', (req, res, next) => { try { res.json(control.resumeAutomation(String(req.body.actor ?? 'operator'), String(req.body.note ?? ''))); } catch (error) { next(error); } });
  app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => { void next; res.status(409).json({ error: error.message }); });
  return app;
}

export async function startOperatorServer(control: ControlPlane, port = 4311): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const app = createOperatorApp(control);
  const server = await new Promise<Server>((resolve) => { const instance = app.listen(port, '127.0.0.1', () => resolve(instance)); });
  return { server, url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
