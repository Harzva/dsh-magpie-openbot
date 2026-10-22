// Desktop carrier for the upstream webServer contract. HTTP stays on a private
// Unix socket; the unmodified plugin's handlers never open a TCP listener.
import { Service } from '__OPENBOT_CORDIS__';
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { chmod, unlink } from 'node:fs/promises';
export default class NativeCarrier extends Service {
  static inject = ['loader', 'configEditor', 'credentials'];
  constructor(ctx, config) { super(ctx, 'webServer'); this.config = config; this.routes = new Map(); }
  register(route) {
    if (route.kind !== 'prefix' || route.path !== '/dsh-x-magpie' || this.routes.has(route.path)) throw Error('Unsupported desktop plugin route');
    this.routes.set(route.path, route.handler); return () => this.routes.delete(route.path);
  }
  async [Service.init]() {
    const expected = Buffer.from('Bearer ' + this.config.token);
    this.server = http.createServer(async (req, res) => {
      const auth = Buffer.from(req.headers.authorization || '');
      if (req.headers.origin || auth.length !== expected.length || !timingSafeEqual(auth, expected)) { res.writeHead(403).end(); return; }
      try {
        if (req.method === 'GET' && req.url === '/openbot/status') {
          const states = ['pending', 'starting', 'active', 'failed', 'disposed', 'stopping'];
          const services = [...this.ctx.loader.entries()].filter(e => ['dsh-x-magpie','native-carrier','config-editor','credentials','llm-pi-ai'].includes(e.options.id))
            .map(e => ({name: e.options.id === 'native-carrier' ? 'webServer' : e.options.id === 'config-editor' ? 'configEditor' : e.options.id,
              state: e.fiber ? states[e.fiber.state] : 'pending', required: Object.keys(e.fiber?.inject || {})}));
          const row = this.ctx.configEditor.configuration().find(r => r.entry.options.id === 'llm-pi-ai');
          const route = {...row?.inherited.providers, ...row?.override.providers}.magpie;
          res.setHeader('content-type','application/json');res.end(JSON.stringify({services, models:route?.models || []}));return;
        }
        const pathname = new URL(req.url, 'http://localhost').pathname;
        const handler = this.routes.get('/dsh-x-magpie');
        if (!handler || !(pathname === '/dsh-x-magpie' || pathname.startsWith('/dsh-x-magpie/'))) {res.writeHead(404).end();return;}
        if (Number(req.headers['content-length']) > 65536) {res.writeHead(413).end();return;}
        await handler(req,res);
      } catch {if(!res.headersSent)res.writeHead(500);res.end(JSON.stringify({error:'Native plugin request failed'}));}
    });
    this.server.requestTimeout=15000;this.server.headersTimeout=10000;
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.config.socketPath,resolve);});
    await chmod(this.config.socketPath,0o600);
    return async()=>{this.server.closeAllConnections();await new Promise(r=>this.server.close(r));await unlink(this.config.socketPath).catch(()=>{});};
  }
}
