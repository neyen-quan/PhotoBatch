'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {waitForReady,validatePatch,launchWorker}=require('../app/updater'),{zipSync,strToU8}=require('fflate'),{hash}=require('../app/util');
test('updater must signal readiness; spawn errors, premature exit and timeout reject',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-ready-')),ready=path.join(dir,'ready');
 function child(){const p=new EventEmitter();p.kill=()=>p.killed=true;return p;}
 try{
  let p=child(),wait=waitForReady(p,ready,{interval:2,timeout:100});fs.writeFileSync(ready,'ready');await wait;assert.ok(!p.killed);fs.unlinkSync(ready);
  p=child();wait=waitForReady(p,ready,{interval:2,timeout:100});p.emit('error',Error('missing powershell'));await assert.rejects(wait,/missing powershell/);assert.equal(p.killed,true);
  p=child();wait=waitForReady(p,ready,{interval:2,timeout:100});p.emit('exit',1);await assert.rejects(wait,/antes de estar listo/);
  p=child();await assert.rejects(waitForReady(p,ready,{interval:2,timeout:15}),/no confirmó/);assert.equal(p.killed,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('future patches can update PowerShell helper with hash validation',()=>{
 const pkg=Buffer.from(JSON.stringify({name:'photobatch',version:'1.2.2'})),helper=Buffer.from('param()\n');
 const files=[['package.json',pkg],['app/apply-update.ps1',helper]],manifest={schema:1,product:'PhotoBatch',from:'1.2.1',to:'1.2.2',files:files.map(([p,b])=>({path:p,sha256:hash(b)}))};
 const zip=zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),...Object.fromEntries(files.map(([p,b])=>['files/'+p,b]))});assert.equal(validatePatch(zip,'1.2.1').files.length,2);
});
test('patch picker points to the requested folder',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8');assert.match(main,/defaultPath:app.getPath\('downloads'\)/);
 const helper=fs.readFileSync(path.join(__dirname,'../app/apply-update.ps1'));assert.deepEqual([...helper.subarray(0,3)],[239,187,191]);
});

const cp=require('node:child_process'),crypto=require('node:crypto');
const worker=require('../app/update-worker');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"PhotoBatch test space "));
 const appRoot=path.join(dir,'resources/app'),staged=path.join(dir,'stage with spaces');
 fs.mkdirSync(path.join(appRoot,'app'),{recursive:true});fs.mkdirSync(path.join(staged,'files/app'),{recursive:true});
 fs.writeFileSync(path.join(appRoot,'package.json'),JSON.stringify({name:'photobatch',version:'1.2.1'}));fs.writeFileSync(path.join(appRoot,'app/a.js'),'old');
 const files=[['package.json',JSON.stringify({name:'photobatch',version:'1.2.4'})],['app/a.js','new'],['app/new.js','added']];
 for(const [name,data] of files)fs.writeFileSync(path.join(staged,'files',name),data);
 const manifest={schema:1,product:'PhotoBatch',from:'1.2.1',to:'1.2.4',files:files.map(([name,data])=>({path:name,sha256:hash(Buffer.from(data))}))};
 fs.writeFileSync(path.join(staged,'manifest.json'),JSON.stringify(manifest));
 return {dir,staged,appRoot,from:'1.2.1',to:'1.2.4'};
}
test('worker installs verified bytes, backs up originals and writes package last',()=>{
 const f=fixture(),order=[];try{
  worker.apply(f,{copy:(a,b)=>{order.push(b);fs.copyFileSync(a,b);}});
  assert.equal(path.basename(order.at(-1)),'package.json');assert.equal(JSON.parse(fs.readFileSync(path.join(f.appRoot,'package.json'))).version,'1.2.4');
  assert.equal(fs.readFileSync(path.join(f.staged,'respaldo/app/a.js'),'utf8'),'old');assert.equal(fs.readFileSync(path.join(f.appRoot,'app/new.js'),'utf8'),'added');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('partial copy failure rolls back modified files and removes newly added files',()=>{
 const f=fixture();try{
  assert.throws(()=>worker.apply(f,{copy:(a,b)=>{fs.copyFileSync(a,b);if(b.endsWith('package.json'))throw Error('simulated disk error');}}),/restauro/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.appRoot,'package.json'))).version,'1.2.1');assert.equal(fs.readFileSync(path.join(f.appRoot,'app/a.js'),'utf8'),'old');assert.equal(fs.existsSync(path.join(f.appRoot,'app/new.js')),false);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('worker rejects tampering and wrong installed version before creating backups',()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.staged,'files/app/a.js'),'tampered');assert.throws(()=>worker.apply(f),/Integridad/);assert.equal(fs.existsSync(path.join(f.staged,'respaldo')),false);
  fs.writeFileSync(path.join(f.appRoot,'package.json'),JSON.stringify({name:'photobatch',version:'1.1.0'}));assert.throws(()=>worker.apply(f),/Version/);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('restart environment exits Electron Node mode',()=>{
 const original=process.env.ELECTRON_RUN_AS_NODE;process.env.ELECTRON_RUN_AS_NODE='1';try{assert.equal(worker.restartEnvironment().ELECTRON_RUN_AS_NODE,undefined);}finally{if(original===undefined)delete process.env.ELECTRON_RUN_AS_NODE;else process.env.ELECTRON_RUN_AS_NODE=original;}
});
async function awaitFile(file,timeout=6000){const end=Date.now()+timeout;while(!fs.existsSync(file)){if(Date.now()>end)throw Error('Missing '+file);await new Promise(r=>setTimeout(r,30));}}
test('real detached worker handshakes, survives parent exit and handles Unicode paths',async()=>{
 const f=fixture();try{
  const launcher=path.join(f.dir,'launch.js');
  fs.writeFileSync(launcher,`require(${JSON.stringify(require.resolve('../app/updater'))}).launchWorker({staged:${JSON.stringify(f.staged)},exe:process.execPath,pid:process.pid,probe:true}).catch(e=>{console.error(e);process.exitCode=1;});`);
  const proc=cp.spawn(process.execPath,[launcher],{stdio:['ignore','ignore','pipe']});let stderr='';proc.stderr.on('data',b=>stderr+=b);
  const code=await new Promise((r,j)=>{proc.on('error',j);proc.on('exit',r);});assert.equal(code,0,stderr);
  await awaitFile(path.join(f.staged,'probe-ok'));assert.match(fs.readFileSync(path.join(f.staged,'actualizacion.log'),'utf8'),/Prueba completa/);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('real worker applies only after parent closes and requests a restart',async()=>{
 const f=fixture();try{
  const launcher=path.join(f.dir,'launch.js'),helper=path.join(f.staged,'worker.js'),jobPath=path.join(f.staged,'job.json');
  fs.copyFileSync(require.resolve('../app/update-worker'),helper);
  // Use a harmless executable for restart; worker itself runs under the real Node runtime.
  fs.writeFileSync(launcher,`const fs=require('node:fs'),cp=require('node:child_process');const j=${JSON.stringify({...f,exe:process.execPath})};j.pid=process.pid;fs.writeFileSync(${JSON.stringify(jobPath)},JSON.stringify(j));const p=cp.spawn(process.execPath,[${JSON.stringify(helper)},${JSON.stringify(jobPath)}],{detached:true,stdio:'ignore'});require(${JSON.stringify(require.resolve('../app/updater'))}).waitForReady(p,${JSON.stringify(path.join(f.staged,'ready'))}).then(()=>{if(JSON.parse(fs.readFileSync(j.appRoot+'/package.json')).version!=='1.2.1')throw Error('Early mutation');fs.writeFileSync(j.staged+'/go','go');p.unref();}).catch(e=>{console.error(e);process.exitCode=1;});`);
  const proc=cp.spawn(process.execPath,[launcher],{stdio:'ignore'});const code=await new Promise((r,j)=>{proc.on('error',j);proc.on('exit',r);});assert.equal(code,0);
  const end=Date.now()+6000;while(!fs.readFileSync(path.join(f.staged,'actualizacion.log'),'utf8').includes('Reapertura solicitada')){if(Date.now()>end)throw Error('worker did not finish');await new Promise(r=>setTimeout(r,30));}
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.appRoot,'package.json'))).version,'1.2.4');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('bootstrap repair exercises launcher before replacing installed files and preserves version',async()=>{
 const f=fixture();try{
  const bundle=path.join(f.dir,'Reparacion');fs.mkdirSync(bundle);
  const manifest=[];
  for(const name of ['updater.js','update-worker.js']){const bytes=fs.readFileSync(path.join(__dirname,'../app',name));fs.writeFileSync(path.join(bundle,name),bytes);manifest.push({name,sha256:hash(bytes)});}
  fs.writeFileSync(path.join(bundle,'repair-manifest.json'),JSON.stringify(manifest));
  fs.copyFileSync(path.join(__dirname,'../build/repair-node.js'),path.join(bundle,'repair-node.js'));
  fs.writeFileSync(path.join(f.appRoot,'app/updater.js'),'old-launcher');
  const result=await new Promise((resolve,reject)=>cp.execFile(process.execPath,[path.join(bundle,'repair-node.js'),f.appRoot],{timeout:10000},(e,stdout,stderr)=>e?reject(Error(stderr||e.message)):resolve(stdout)));
  assert.match(result,/PRUEBA REAL CORRECTA/);assert.match(result,/REPARACION V2 COMPLETADA/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.appRoot,'package.json'))).version,'1.2.1');
  assert.equal(fs.readFileSync(path.join(f.appRoot,'app/updater.js'),'utf8'),fs.readFileSync(path.join(bundle,'updater.js'),'utf8'));
  const backup=fs.readdirSync(f.appRoot).find(n=>n.startsWith('respaldo-actualizador-'));assert.equal(fs.readFileSync(path.join(f.appRoot,backup,'updater.js'),'utf8'),'old-launcher');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('worker without go cannot install when the parent disappears',async()=>{
 const f=fixture();try{
  const launcher=path.join(f.dir,'cancel.js'),helper=require.resolve('../app/update-worker'),jobFile=path.join(f.staged,'job.json');
  fs.writeFileSync(launcher,`const fs=require('node:fs'),cp=require('node:child_process');const job=${JSON.stringify({...f,exe:process.execPath})};job.pid=process.pid;fs.writeFileSync(${JSON.stringify(jobFile)},JSON.stringify(job));const p=cp.spawn(process.execPath,[${JSON.stringify(helper)},${JSON.stringify(jobFile)}],{detached:true,stdio:'ignore'});require(${JSON.stringify(require.resolve('../app/updater'))}).waitForReady(p,${JSON.stringify(path.join(f.staged,'ready'))}).then(()=>p.unref());`);
  const proc=cp.spawn(process.execPath,[launcher],{stdio:'ignore'});await new Promise((r,j)=>{proc.on('error',j);proc.on('exit',r);});
  const end=Date.now()+6000;while(!fs.readFileSync(path.join(f.staged,'actualizacion.log'),'utf8').includes('No se recibio autorizacion')){if(Date.now()>end)throw Error('Worker failed to cancel');await new Promise(r=>setTimeout(r,30));}
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.appRoot,'package.json'))).version,'1.2.1');assert.equal(fs.existsSync(path.join(f.staged,'respaldo')),false);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
