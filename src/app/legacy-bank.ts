import express, { type Express } from 'express';
import type { Server } from 'node:http';

const members = {
  'M-1001': { name: 'Jamie Rivera', status: 'Active', checking: 4821.19, savings: 12750.44 },
  'M-2048': { name: 'Morgan Chen', status: 'Active', checking: 935.77, savings: 25004.01 },
  'M-4100': { name: 'Taylor Brooks', status: 'Restricted', checking: 120.11, savings: 815.5 }
} as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
}

function shell(tenant: string, scenario: string): string {
  const brand = tenant === 'summit' ? 'SUMMIT COMMUNITY CU' : 'HARBOR COMMUNITY BANK';
  return `<!doctype html>
<html><head><title>${brand} Core Servicing</title><style>
body{margin:0;background:#d8d8d8;font:12px Arial;color:#111}.top{background:#163a60;color:white;padding:8px 14px;border-bottom:4px solid #caa54a}.top b{font-size:15px}.meta{float:right}iframe{width:100%;height:calc(100vh - 47px);border:0;background:#f4f1e8}
</style></head><body><div class="top"><b>${brand}</b> &nbsp; CORE SERVICING 7.4 <span class="meta">Operator: DEMO01 | Training data only</span></div><iframe title="Member servicing workspace" src="/tenant/${tenant}/workspace?scenario=${encodeURIComponent(scenario)}"></iframe></body></html>`;
}

function workspace(tenant: string, scenario: string, memberId?: string): string {
  const variant = tenant === 'summit';
  const member = memberId ? members[memberId as keyof typeof members] : undefined;
  const searchLabel = variant ? 'Account / Member No.' : 'Member Number';
  const searchButton = variant ? 'Locate' : 'Search';
  const injectedApproval = scenario === 'approval' ? `
    <div class="shade"></div><div class="dialog" role="dialog" aria-label="Supervisor review required">
      <h3>Supervisor review required</h3><p>This training session was selected for manual review.</p>
      <button onclick="sessionStorage.setItem('supervisorReviewed','1');this.parentElement.previousElementSibling.remove();this.parentElement.remove()">Supervisor reviewed</button>
    </div><script>if(sessionStorage.getItem('supervisorReviewed')==='1'){document.querySelector('.shade')?.remove();document.querySelector('.dialog')?.remove()}</script>` : '';
  const timeout = scenario === 'timeout' ? `<div class="error" role="alert">SESSION EXPIRED: Please sign in again. Error SEC-401.</div>` : '';

  let result = '<div class="hint">Enter a member number to begin.</div>';
  if (memberId && !member) result = `<div class="notfound" role="status">No member was found for ${escapeHtml(memberId)}.</div>`;
  if (member) result = `
    <table class="panel" summary="Member profile"><tr><th colspan="4">MEMBER PROFILE</th></tr>
      <tr><td class="key">Member</td><td>${escapeHtml(member.name)}</td><td class="key">Status</td><td>${member.status}</td></tr>
      <tr><td class="key">Member Number</td><td>${escapeHtml(memberId ?? '')}</td><td class="key">Last Review</td><td>08/15/2026</td></tr>
    </table>
    <table class="grid" summary="Deposit accounts"><caption>DEPOSIT ACCOUNTS</caption>
      <tr><th>Product</th><th>Suffix</th><th>Available Balance</th><th>Ledger Balance</th><th>Status</th></tr>
      <tr><td>Primary Checking</td><td>00</td><td>$${member.checking.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td><td>$${member.checking.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td><td>Open</td></tr>
      <tr><td>Savings</td><td>01</td><td data-field="savings-balance" aria-label="Savings available balance">$${member.savings.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td><td>$${member.savings.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td><td>Open</td></tr>
    </table>
    <div class="actions"><button>View History</button><button>New Sub-Account</button><button class="danger">Restrict Account</button></div>`;

  return `<!doctype html><html><head><title>Workspace</title><style>
body{margin:0;background:#f4f1e8;font:12px Arial;color:#222}.nav{background:#3e5369;color:#fff;padding:5px 10px}.nav span{padding:5px 16px;border-right:1px solid #788}.crumb{padding:7px 12px;background:#e2dfd5;border-bottom:1px solid #999}.search{margin:14px auto;width:92%;background:#ddd7c8;border:1px solid #777}.search th,.panel th{background:#274d70;color:#fff;text-align:left;padding:5px}.search td{padding:10px}.search input{width:230px;padding:4px;border:2px inset #eee}.search button,.actions button,.dialog button{margin-left:8px;padding:4px 14px}.content{width:92%;margin:auto}.panel,.grid{width:100%;border-collapse:collapse;margin-top:10px;background:white}.panel td,.grid td,.grid th{border:1px solid #999;padding:6px}.key{background:#e8e8e8;font-weight:bold;width:18%}.grid caption{background:#274d70;color:white;text-align:left;font-weight:bold;padding:5px}.grid th{background:#d9e2e8;text-align:left}.hint{border:1px solid #b1a77f;background:#fffbe4;padding:12px}.notfound,.error{border:1px solid #a00;background:#fee;color:#800;font-weight:bold;padding:12px}.actions{padding:12px 0;text-align:right}.danger{color:#900}.shade{position:fixed;inset:0;background:#0008;z-index:5}.dialog{position:fixed;z-index:6;left:50%;top:35%;transform:translate(-50%,-50%);width:340px;background:#eee;border:3px outset #ddd;padding:16px}.dialog h3{margin-top:0;color:#742}
</style></head><body><div class="nav"><span>MEMBERS</span><span>ACCOUNTS</span><span>TRANSACTIONS</span><span>ADMIN</span></div><div class="crumb">Home &gt; Member Servicing &gt; Inquiry</div>
${timeout}<form class="search" method="get"><input type="hidden" name="scenario" value="${escapeHtml(scenario)}"><table><tr><th colspan="3">MEMBER INQUIRY</th></tr><tr><td>${searchLabel}</td><td><input name="member" title="${searchLabel}" value="${escapeHtml(memberId ?? '')}" autocomplete="off"></td><td><button type="submit">${searchButton}</button></td></tr></table></form><div class="content">${result}</div>${injectedApproval}</body></html>`;
}

export function createLegacyBankApp(): Express {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/tenant/:tenant', (req, res) => {
    if (!['harbor', 'summit'].includes(req.params.tenant ?? '')) return res.status(404).send('Unknown tenant');
    res.send(shell(req.params.tenant!, String(req.query.scenario ?? 'normal')));
  });
  app.get('/tenant/:tenant/workspace', (req, res) => {
    if (!['harbor', 'summit'].includes(req.params.tenant ?? '')) return res.status(404).send('Unknown tenant');
    res.send(workspace(req.params.tenant!, String(req.query.scenario ?? 'normal'), req.query.member ? String(req.query.member).toUpperCase() : undefined));
  });
  return app;
}

export async function startLegacyBank(port = 4310): Promise<{ server: Server; baseUrl: string; close: () => Promise<void> }> {
  const app = createLegacyBankApp();
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(port, '127.0.0.1', () => resolve(instance));
  });
  return { server, baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
