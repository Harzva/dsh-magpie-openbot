'use strict';
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), http=require('node:http');
const {randomBytes,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {installLocalDshBundle}=require('./local-dsh-bundle');
const {writeJson}=require('./persistence');
const {resolveDshRuntimeModule,resolveDshNodeExecutable}=require('./dsh-module');
const PLUGIN='@straydragon/dsh-x-magpie';
const VERIFIED_BUNDLE='5956c29557a38c95dde0b7f569761739d0795425c95ac1e6677c1c15ae06eee1';
function fail(code,message){throw Object.assign(new Error(message),{code});}
function privateDir(dir){fs.mkdirSync(dir,{recursive:true,mode:0o700});const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.mode&0o077)fail('MAGPIE_STORAGE','插件目录权限无效。');}
function read(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.mode&0o077||s.size>1024*1024)fail('MAGPIE_STORAGE','插件配置无法安全读取。');return JSON.parse(fs.readFileSync(file,'utf8'));}
function fields(input,allowed){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('MAGPIE_INVALID','插件设置包含未知字段。');}
function gateway(value){let u;try{u=new URL(value);}catch{fail('MAGPIE_URL','请输入本机 Magpie 网关地址。');}
 if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')fail('MAGPIE_URL','当前仅支持本机 HTTP 网关根地址。');return u.origin.replace('localhost','127.0.0.1');}
class MagpieManager {
 constructor({home,config,assertOpen=()=>{}}){this.home=path.join(home,'dsh-apps');this.file=path.join(this.home,'settings.json');this.config=config;this.assertOpen=assertOpen;this.queue=Promise.resolve();this.pending=0;this.closed=false;this.run=null;this.state='stopped';this.message='';this.services=[];this.models=[];
  this.data={version:1,gatewayUrl:'http://127.0.0.1:3425',apiKey:'',installed:null};
  try{if(fs.existsSync(this.home))privateDir(this.home);if(fs.existsSync(this.file)){const d=read(this.file);if(d.version!==1||typeof d.apiKey!=='string')throw Error();gateway(d.gatewayUrl);this.data=d;}}catch{this.storageError=true;}
 }
 ready(){this.assertOpen();if(this.closed)fail('MAGPIE_CLOSED','插件管理器已关闭。');if(this.storageError)fail('MAGPIE_STORAGE','插件配置无法安全读取，请检查本机数据目录。');}
 serial(fn){this.pending++;const task=this.queue.then(()=>{this.ready();return fn();}).finally(()=>this.pending--);this.queue=task.catch(()=>{});return task;}
 persist(next){this.ready();privateDir(this.home);writeJson(this.file,next);this.data=next;}
 status(){const i=this.data.installed;return {ok:!this.storageError,status:{installed:i?{name:i.packageName,version:i.version,verifiedOriginal:i.bundleSha256===VERIFIED_BUNDLE,requiredServices:i.requiredServices||[],requiredServicesEvidence:i.requiredServicesEvidence,runtimeDependenciesStatus:i.runtimeDependenciesStatus,sourceSha256:i.sourceSha256}:null,enabled:!!this.run,state:this.state,message:this.storageError?'插件配置无法安全读取。':this.message,services:this.services,models:this.models,gatewayUrl:this.data.gatewayUrl,hasKey:!!this.data.apiKey}};}
 refresh(){return this.serial(async()=>{if(this.run){try{const live=await this.request('/openbot/status');this.services=live.services;const plugin=live.services.find(x=>x.name==='dsh-x-magpie');this.state=plugin?.state==='active'?'active':'pending';}catch{await this.stop();this.state='failed';this.message='插件服务已停止，请重新启用。';}}return this.status();});}
 isBusy(){return this.pending>0;}
 install({sourcePath}){return this.serial(async()=>{if(this.run)fail('MAGPIE_RUNNING','请先停用插件再安装。');privateDir(this.home);const receipt=await installLocalDshBundle({sourcePath,storeRoot:path.join(this.home,'bundles')});this.persist({...this.data,installed:receipt});this.models=[];this.services=(receipt.requiredServices||[]).map(name=>({name,state:'pending',missing:[name]}));this.state='stopped';this.message=receipt.packageName===PLUGIN?'已安装，启用后检查实际依赖状态。':'已安装到本机插件目录；此插件尚未配置宿主服务，未执行。';return this.status();});}
 configure(input){return this.serial(async()=>{fields(input,['gatewayUrl','apiKey']);if(this.run)fail('MAGPIE_RUNNING','请先停用连接再修改配置。');const url=gateway(input.gatewayUrl||this.data.gatewayUrl);if(input.apiKey!==undefined&&(typeof input.apiKey!=='string'||input.apiKey.length>16384||/[\r\n\0]/.test(input.apiKey)))fail('MAGPIE_KEY','网关密钥格式无效。');this.persist({...this.data,gatewayUrl:url,apiKey:input.apiKey===undefined?this.data.apiKey:input.apiKey.trim()});this.models=[];return this.status();});}
 async request(url,body){this.ready();const run=this.run;if(!run)fail('MAGPIE_STOPPED','请先启用连接。');return new Promise((resolve,reject)=>{const req=http.request({socketPath:run.socketPath,path:url,method:body?'POST':'GET',headers:{authorization:'Bearer '+run.token,'content-type':'application/json'}},res=>{let text='';res.on('data',b=>{text+=b;if(text.length>1024*1024)req.destroy(Error('oversize'));});res.on('end',()=>{try{const value=JSON.parse(text);if(res.statusCode!==200||value.error)fail('MAGPIE_REQUEST','插件操作未成功，请检查网关连接和密钥。');resolve(value);}catch(e){reject(e);}});});req.setTimeout(15000,()=>req.destroy(Error('timeout')));req.on('error',()=>reject(Object.assign(new Error('插件服务暂不可用。'),{code:'MAGPIE_REQUEST'})));req.end(body?JSON.stringify(body):undefined);});}
 enable(){return this.serial(async()=>{if(this.run)return this.status();const installed=this.data.installed;if(!installed)fail('MAGPIE_NOT_INSTALLED','请先导入 DSH 插件。');if(installed.packageName!==PLUGIN||installed.version!=='0.7.2')fail('MAGPIE_UNSUPPORTED','已保存此插件；当前应用连接仅验收 Magpie 插件 0.7.2。');
  this.state='starting';this.message='';
  try{await this.start();this.ready();const status=await this.request('/openbot/status');this.services=status.services;const plugin=this.services.find(x=>x.name==='dsh-x-magpie');if(!plugin||plugin.state!=='active'){this.state='pending';this.message='插件正在等待宿主服务。';await this.stop();return this.status();}
   await this.request('/dsh-x-magpie/key',{value:this.data.apiKey||'magpie'});this.state='active';this.message='插件与宿主服务已启用；可以刷新模型。';return this.status();
  }catch(e){await this.stop();this.state='failed';this.message='插件启动失败，请检查依赖和本机配置。';throw e;}
 });}
 async start(){privateDir(this.home);const rt=require('./bundle-fingerprint');const i=this.data.installed;
  const fingerprint=rt.fingerprintBundle(i.bundlePath,{version:i.version});if(fingerprint.sha256!==i.bundleSha256)fail('MAGPIE_CHANGED','已安装插件文件发生变化，请重新安装。');
  if(fingerprint.sha256!==VERIFIED_BUNDLE)fail('MAGPIE_UNSUPPORTED','此插件内容与已验证的原版不符；已保存但不会执行。');
  const sdkLocation=resolveDshRuntimeModule(require.resolve('@deepseek-ai/dsh-sdk-client'));const {HarnessClient}=await import(sdkLocation);
  const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ob-magpie-')));fs.chmodSync(temp,0o700);
  let adopted=false;
  try {
  const base=path.join(this.home,'runtime'),home=path.join(base,'home'),dshHome=path.join(home,'dsh'),profile=path.join(dshHome,'profiles/magpie');
  for(const d of [base,home,dshHome,path.join(base,'tmp'),profile,path.join(profile,'node_modules/@straydragon')])privateDir(d);
  const token=randomBytes(32).toString('hex'),socketPath=path.join(temp,'control.sock');
  const pluginFile=path.join(base,'native-carrier.mjs');const cordis=resolveDshRuntimeModule(require.resolve('@deepseek-ai/cordis'));
  fs.writeFileSync(pluginFile,fs.readFileSync(path.join(__dirname,'magpie-native-services.mjs'),'utf8').replace('__OPENBOT_CORDIS__',cordis),{mode:0o600});
  // Keep the disposable carrier portable and compatible with the profile's
  // no-symlink archive boundary. Never replace unknown runtime contents.
  const link=path.join(profile,'node_modules',PLUGIN);
  let copied=false;
  try {
   const stat=fs.lstatSync(link);
   if(stat.isSymbolicLink()) {
    if(fs.realpathSync(link)!==fs.realpathSync(i.bundlePath))fail('MAGPIE_STORAGE','插件运行目录包含未知链接。');
    fs.unlinkSync(link);
   } else {
    if(!stat.isDirectory()||rt.fingerprintBundle(link,{version:i.version}).sha256!==i.bundleSha256)fail('MAGPIE_STORAGE','插件运行目录存在未知文件。');
    copied=true;
   }
  } catch(error) { if(error.code!=='ENOENT')throw error; }
  if(!copied)fs.cpSync(i.bundlePath,link,{recursive:true,dereference:false,filter:source=>{
   if(fs.lstatSync(source).isSymbolicLink())fail('MAGPIE_STORAGE','插件文件不能包含链接。');return true;
  }});
  if(rt.fingerprintBundle(link,{version:i.version}).sha256!==i.bundleSha256)fail('MAGPIE_CHANGED','插件运行副本校验失败。');
  fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify({name:'openbot-magpie-services',private:true,dependencies:{[PLUGIN]:i.version},dsh:{profile:{bundles:['@deepseek-ai/dsh-sdk-minimal',PLUGIN]}}}),{mode:0o600});
  const seed={displayName:'OpenBot control',api:'openai-completions',baseURL:'http://127.0.0.1:9/v1',apiKeyEnv:'OPENBOT_UNUSED_KEY',models:[{id:'control',name:'Control',contextWindow:2048,maxTokens:128}]};
  fs.writeFileSync(path.join(profile,'cordis.patch.yml'),JSON.stringify([
   ...['tool-fs','tool-working-directory','persistent-bash','persistent-pwsh','llm-deepseek','compaction-basic','image-offload'].map(id=>({id,disabled:true})),
   {id:'dsh-x-magpie',config:{gatewayUrl:this.data.gatewayUrl,routeName:'magpie',credentialRef:'MAGPIE_GATEWAY_KEY',api:'openai-completions'}},
   {insert:[{id:'config-editor',name:'@deepseek-ai/dsh-config-editor'},{id:'credentials',name:'@deepseek-ai/dsh-credentials-local',config:{dshHome,path:path.join(dshHome,'.credentials.yaml'),watch:false}},{id:'llm-pi-ai',name:'@deepseek-ai/dsh-llm-pi-ai',config:{providers:{'openbot-control':seed}}},{id:'native-carrier',name:pluginFile,config:{token,socketPath}}]}
  ]),{mode:0o600});
  const node=resolveDshNodeExecutable()||process.execPath;const dshBin=new URL(resolveDshRuntimeModule(path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')),'lib/bin.js')));
  const {fileURLToPath}=require('node:url');const bin=fileURLToPath(dshBin),env={PATH:path.dirname(node)+':/usr/bin:/bin',HOME:home,DSH_HOME:dshHome,TMPDIR:path.join(base,'tmp'),DSH_TELEMETRY_DISABLED:'1'};
  const opts={dshBin:bin,profile:'magpie',dshHome,processCwd:base,env,initializeTimeoutMs:20000,requestTimeoutMs:15000};
  const client=new HarnessClient(opts,{command:node,args:[bin,'--profile','magpie'],cwd:base,environment:()=>env,description:'OpenBot Magpie services',initializeTimeoutMs:20000,requestTimeoutMs:15000});
  this.run={client,socketPath,token,temp};adopted=true;await client.initialize({cwd:base,provider:'openbot-control',model:'control'});
  } catch(error) { if(!adopted)fs.rmSync(temp,{recursive:true,force:true});throw error; }
 }
 sync(){return this.serial(async()=>{if(this.state!=='active')fail('MAGPIE_STOPPED','请先启用连接。');try{await this.request('/dsh-x-magpie/plan',{});await this.request('/dsh-x-magpie/apply',{});const status=await this.request('/openbot/status');this.services=status.services;this.models=status.models.map(m=>({id:m.id,contextWindow:m.contextWindow,maxTokens:m.maxTokens,input:m.input,reasoningEfforts:m.reasoningEfforts}));this.message='模型目录已同步。';return this.status();}catch(e){this.message='模型同步失败，保留上一次模型目录。';throw e;}});}
 useModel(input){return this.serial(async()=>{fields(input,['modelId']);if(this.state!=='active'||!this.models.some(m=>m.id===input.modelId))fail('MAGPIE_MODEL','请选择已同步的模型。');const id='magpie_'+createHash('sha256').update(this.data.gatewayUrl+'\0'+input.modelId).digest('hex').slice(0,16);const result=this.config.upsertProfile({id,name:'Magpie · '+input.modelId,baseUrl:this.data.gatewayUrl+'/v1',apiKey:this.data.apiKey||'magpie',model:input.modelId});if(!result.ok)fail(result.code,result.message);return {...this.status(),profileId:id,message:'已保存为模型连接，可在 BOT 设置中选择。'};});}
 async stop(){const r=this.run;if(r){await r.client.close();if(this.run===r)this.run=null;fs.rmSync(r.temp,{recursive:true,force:true});}}
 disable(){return this.serial(async()=>{await this.stop();this.state='stopped';this.services=this.services.map(s=>({...s,state:'stopped'}));this.message='已停用；保存的模型连接仍可直接访问 Magpie 网关。';return this.status();});}
 async close(){this.closed=true;await this.queue;await this.stop();}
}
module.exports={MagpieManager};
