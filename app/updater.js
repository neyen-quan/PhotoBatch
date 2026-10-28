'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function validatePatch(buf,from){
 const {unzipSync}=require('fflate');
 if(buf.length>30*1024*1024)throw Error('Parche demasiado grande (máximo 30 MiB).');
 const zip=unzipSync(new Uint8Array(buf)),raw=zip['manifest.json'];if(!raw)throw Error('No contiene manifest.json.');
 const manifest=JSON.parse(Buffer.from(raw).toString('utf8'));
 if(manifest.schema!==1||manifest.product!=='PhotoBatch'||manifest.from!==from||!/^\d+\.\d+\.\d+$/.test(manifest.to)||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>50)throw Error('Parche inválido o para otra versión de PhotoBatch.');
 const ver=v=>v.split('.').map(Number);const a=ver(from),b=ver(manifest.to);if(!(b[0]>a[0]||b[0]===a[0]&&b[1]>a[1]||b[0]===a[0]&&b[1]===a[1]&&b[2]>a[2]))throw Error('El parche debe instalar una versión posterior.');
 const files=[],seen=new Set();
 for(const f of manifest.files){
  const rel=f.path;
  if(typeof rel!=='string'||!/^app\/[a-zA-Z0-9_.-]+\.(js|css|html|png|ico|ps1)$/.test(rel)&&rel!=='package.json')throw Error('Ruta prohibida en el parche.');
  if(seen.has(rel)||!(/^[a-f0-9]{64}$/.test(f.sha256)))throw Error('Manifest inválido.');seen.add(rel);
  const bytes=zip['files/'+rel];if(!bytes||bytes.length>3*1024*1024||sha(bytes)!==f.sha256)throw Error('Firma de integridad incorrecta: '+rel);
  files.push({path:rel,bytes:Buffer.from(bytes),sha256:f.sha256});
 }
 if(!seen.has('package.json'))throw Error('Falta actualizar la versión del programa (package.json).');
 const pkg=JSON.parse(files.find(x=>x.path==='package.json').bytes.toString());if(pkg.version!==manifest.to||pkg.name!=='photobatch')throw Error('Versión del paquete inconsistente.');
 return {manifest,files};
}
function waitForReady(proc,ready,{timeout=15000,interval=80}={}){return new Promise((resolve,reject)=>{
 let finished=false;
 const finish=error=>{if(finished)return;finished=true;clearInterval(poll);clearTimeout(timer);proc.removeListener('error',onError);proc.removeListener('exit',onExit);if(error){try{proc.kill();}catch{}reject(error);}else resolve();};
 const onError=e=>finish(Error('No se pudo iniciar el actualizador: '+e.message));
 const onExit=code=>finish(Error('El actualizador se cerró antes de estar listo (código '+code+'). PhotoBatch seguirá abierto.'));
 const poll=setInterval(()=>{if(fs.existsSync(ready))finish();},interval);
 const timer=setTimeout(()=>finish(Error('El actualizador no confirmó su inicio. PhotoBatch seguirá abierto.')),timeout);
 proc.once('error',onError);proc.once('exit',onExit);
});}
async function startUpdate({patchPath,appRoot,version,userData,exe,showConfirmation}){
 if(process.platform!=='win32')throw Error('El actualizador requiere Windows.');
 const zip=fs.readFileSync(patchPath);const {manifest,files}=validatePatch(zip,version);
 if(!await showConfirmation({from:version,to:manifest.to,files:files.length}))return {canceled:true};
 const base=path.join(userData,'updates');fs.mkdirSync(base,{recursive:true});const staged=fs.mkdtempSync(path.join(base,'stage-'));const stagedFiles=path.join(staged,'files');
 for(const f of files){const dest=path.join(stagedFiles,...f.path.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,f.bytes,{flag:'wx'});}
 fs.writeFileSync(path.join(staged,'manifest.json'),JSON.stringify(manifest,null,2));
 await launchWorker({staged,appRoot,exe,pid:process.pid,from:version,to:manifest.to});
 return {started:true,version:manifest.to};
}
async function launchWorker(job,{helperSource=path.join(__dirname,'update-worker.js')}={}){
 const {staged,exe}=job;
 const helper=path.join(staged,'worker.js');fs.copyFileSync(helperSource,helper);
 fs.writeFileSync(path.join(staged,'job.json'),JSON.stringify(job));
 const log=path.join(staged,'inicio.log');
 fs.appendFileSync(log,`${new Date().toISOString()} Lanzador Node v2; ejecutable: ${exe}\n`);
 const output=fs.openSync(log,'a');let proc;
 try{proc=cp.spawn(exe,[helper,path.join(staged,'job.json')],{
  detached:true,windowsHide:true,cwd:staged,
  env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore',output,output]
 });}finally{fs.closeSync(output);}
 try{
  await waitForReady(proc,path.join(staged,'ready'));
  fs.writeFileSync(path.join(staged,'go'),'go',{flag:'wx'});
 }catch(e){
  let detail='';try{detail=fs.readFileSync(path.join(staged,'actualizacion.log'),'utf8').slice(-2000);}catch{}
  throw Error(e.message+' '+detail+' Registro: '+log);
 }
 proc.unref();return proc;
}
module.exports={validatePatch,startUpdate,waitForReady,launchWorker};
