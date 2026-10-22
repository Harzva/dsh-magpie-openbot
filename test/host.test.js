'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { createMagpieHost, MagpieManager, installLocalDshBundle } = require('..');
const { Config } = require('./config-fixture');
function setup(t, assertOpen) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-host-test-')));
  const config = new Config(home), host = createMagpieHost({ home, config, assertOpen });
  t.after(async () => {
    await host.close();
    function unlock(dir) { fs.chmodSync(dir, 0o700); for (const n of fs.readdirSync(dir)) { const p=path.join(dir,n); if(fs.lstatSync(p).isDirectory()) unlock(p); } }
    unlock(home); fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, config, host };
}
test('public exports and rejected dispatch never create settings or import arbitrary code', async t => {
  assert.equal(typeof MagpieManager, 'function'); assert.equal(typeof installLocalDshBundle, 'function');
  const { home, host } = setup(t);
  const cases = [['constructor', {}], ['install', {sourcePath:'/tmp/evil'}], ['install',{kind:'bundled'}], ['install',{code:'evil'}], ['status',[]], ['enable',null], ['sync',{ extra:true }], ['configure',{}], ['configure',{apiKey:undefined}], ['configure',{apiKey:'bad\nkey'}], ['configure',{gatewayUrl:''}], ['useModel',{modelId:''}], ['useModel',{modelId:'a', extra:1}]];
  const accessor = {}; Object.defineProperty(accessor, 'apiKey', {get(){ throw Error('getter executed'); }}); cases.push(['configure',accessor]);
  for (const [operation,input] of cases) await assert.rejects(host.invoke(operation,input),{code:'MAGPIE_INVALID'});
  assert.equal(fs.existsSync(path.join(home,'dsh-apps')),false); assert.equal(host.isBusy(),false);
});
test('authority checked at dispatch and again inside shared manager queue', async t => {
  let allowed=true, count=0;
  const {home,host}=setup(t,()=>{ count++; if(!allowed)throw Object.assign(Error('revoked'),{code:'REVOKED'}); });
  const queued=host.invoke('configure',{apiKey:'never stored'}); allowed=false;
  await assert.rejects(queued,{code:'REVOKED'});
  assert.equal(fs.existsSync(path.join(home,'dsh-apps')),false);
  await assert.rejects(host.invoke('status'),{code:'REVOKED'}); assert.ok(count>=3);
});
test('fixed original bundle, real services, shared host state and model config survive reopen', async t => {
  const {home,host,config}=setup(t); let calls=0;
  const gateway=http.createServer((req,res)=>{ calls++; assert.equal(req.url,'/v1/models'); assert.equal(req.headers.authorization,'Bearer OWNED_HOST_KEY'); res.setHeader('content-type','application/json'); res.end(JSON.stringify({data:[{id:'owned/host-model',context_window:32000,max_output_tokens:2048}]})); });
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>gateway.close(r)));
  assert.equal((await host.invoke('status')).status.installed,null);
  const installed=await host.invoke('install',{}); assert.equal(installed.status.installed.verifiedOriginal,true);
  assert.equal(installed.status.installed.sourceSha256,'8f8b2c4ab1306c9789c5957e8b2b44a38950a15d2bb9b5e58189721616cc221e');
  await host.invoke('configure',{gatewayUrl:`http://127.0.0.1:${gateway.address().port}`,apiKey:'OWNED_HOST_KEY'});
  assert.equal((await host.invoke('enable')).status.state,'active'); assert.equal(calls,0);
  const result=await host.invoke('sync'); assert.equal(result.status.models[0].id,'owned/host-model'); assert.equal(calls,2); assert.ok(!JSON.stringify(result).includes('OWNED_HOST_KEY'));
  const model=await host.invoke('useModel',{modelId:'owned/host-model'}); assert.equal(config.effective(model.profileId).model,'owned/host-model');
  await host.invoke('disable'); assert.equal((await host.invoke('status')).status.enabled,false);
  await host.close(); await assert.rejects(host.invoke('status'),{code:'MAGPIE_CLOSED'});
  const reopened=createMagpieHost({home,config}); try { const status=await reopened.invoke('status'); assert.equal(status.status.enabled,false); assert.equal(status.status.installed.version,'0.7.2'); assert.equal(status.status.hasKey,true); } finally {await reopened.close();}
});
