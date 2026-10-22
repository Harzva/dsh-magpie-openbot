'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {MagpieManager}=require('../src/magpie-manager');
const {Config}=require('./config-fixture');
function removeOwned(root){for(const n of fs.readdirSync(root)){const p=path.join(root,n),s=fs.lstatSync(p);if(s.isDirectory()&&!s.isSymbolicLink())removeOwned(p);}fs.chmodSync(root,0o700);}
const archive=path.resolve(__dirname,'../vendor/dsh-x-magpie-0.7.2.tgz');
test('original plugin: native carrier, real DSH services, sync, secret, stop and restart',async t=>{
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'magpie-native-test-')));let calls=0;
 const gateway=http.createServer((req,res)=>{calls++;assert.equal(req.url,'/v1/models');assert.equal(req.headers.authorization,'Bearer OWNED_GATEWAY_KEY');res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'owned/model',context_window:64000,max_output_tokens:4096,modalities:{input:['text','image']}}]}));});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));const config=new Config(home);const manager=new MagpieManager({home,config});
 t.after(async()=>{await manager.close();await new Promise(r=>gateway.close(r));removeOwned(home);fs.rmSync(home,{recursive:true,force:true});});
 assert.equal(manager.status().status.enabled,false);await manager.install({sourcePath:archive});
 assert.deepEqual(manager.status().status.services.map(x=>x.name),['webServer','configEditor','credentials']);
 await manager.configure({gatewayUrl:`http://127.0.0.1:${gateway.address().port}`,apiKey:'OWNED_GATEWAY_KEY'});
 const active=await manager.enable();assert.equal(active.status.state,'active');assert.ok(active.status.services.every(x=>x.state==='active'));
 assert.equal(calls,0,'startup must never call a model provider');
 const sync=await manager.sync();assert.equal(sync.status.models[0].id,'owned/model');assert.equal(sync.status.models[0].contextWindow,64000);assert.equal(calls,2);
 assert.ok(!JSON.stringify(sync).includes('OWNED_GATEWAY_KEY'));assert.equal(sync.status.models[0].input.length,2);
 const origin=manager.run.socketPath;assert.equal(fs.statSync(origin).mode&0o077,0);
 const unauthorized=await new Promise((resolve,reject)=>{const r=http.get({socketPath:origin,path:'/dsh-x-magpie/state'},s=>{s.resume();resolve(s.statusCode);});r.on('error',reject);});assert.equal(unauthorized,403);
 const used=await manager.useModel({modelId:'owned/model'});assert.equal(used.ok,true);assert.equal(config.effective(used.profileId).model,'owned/model');
 await manager.disable();assert.equal(fs.existsSync(origin),false);assert.equal(manager.status().status.enabled,false);
 await manager.enable();assert.equal(manager.status().status.state,'active');await manager.disable();
 // The merged unified-profile boundary must inventory the real carrier after restart.
 const carrier=path.join(home,'dsh-apps/runtime/home/dsh/profiles/magpie/node_modules/@straydragon/dsh-x-magpie');assert.equal(fs.lstatSync(carrier).isSymbolicLink(),false);
 const reopened=new MagpieManager({home,config});assert.equal(reopened.status().status.enabled,false);assert.equal(reopened.status().status.installed.version,'0.7.2');await reopened.close();
});
test('invalid gateway and changed installed bundle fail without a running service',async t=>{
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'magpie-invalid-')));const m=new MagpieManager({home,config:{}});t.after(async()=>{await m.close();removeOwned(home);fs.rmSync(home,{recursive:true,force:true});});
 await assert.rejects(m.configure({gatewayUrl:'https://example.com/'}),{code:'MAGPIE_URL'});await assert.rejects(m.enable(),{code:'MAGPIE_NOT_INSTALLED'});
 await m.install({sourcePath:archive});const file=path.join(m.data.installed.bundlePath,'dist/index.js');fs.chmodSync(file,0o600);fs.appendFileSync(file,'\n//changed');await assert.rejects(m.enable(),{code:'MAGPIE_CHANGED'});assert.equal(m.status().status.enabled,false);
 const rt=require('../src/bundle-fingerprint');m.data.installed.bundleSha256=rt.fingerprintBundle(m.data.installed.bundlePath).sha256;
 await assert.rejects(m.enable(),{code:'MAGPIE_UNSUPPORTED'});assert.equal(m.status().status.installed.verifiedOriginal,false);
});
