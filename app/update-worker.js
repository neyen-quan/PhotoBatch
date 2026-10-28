'use strict';
// Standalone: runs in Electron's Node mode; no PowerShell or installed modules.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
function validate(job){
 const {staged,appRoot,from,to}=job;
 const manifest=JSON.parse(fs.readFileSync(path.join(staged,'manifest.json'),'utf8'));
 const pkg=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'),'utf8'));
 if(manifest.schema!==1||manifest.product!=='PhotoBatch'||manifest.from!==from||manifest.to!==to||pkg.name!=='photobatch'||pkg.version!==from)throw Error('Version o producto incorrectos.');
 const ver=v=>/^\d+\.\d+\.\d+$/.test(v)&&v.split('.').map(Number);
 const a=ver(from),b=ver(to);if(!a||!b||!(b[0]>a[0]||b[0]===a[0]&&b[1]>a[1]||b[0]===a[0]&&b[1]===a[1]&&b[2]>a[2]))throw Error('La version debe aumentar.');
 if(!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>50)throw Error('Lista de archivos invalida.');
 const seen=new Set();
 for(const f of manifest.files){
  if(typeof f.path!=='string'||(f.path!=='package.json'&&!/^app\/[a-zA-Z0-9_.-]+\.(js|css|html|png|ico|ps1)$/.test(f.path))||seen.has(f.path))throw Error('Ruta de archivo invalida.');
  seen.add(f.path);
  const data=fs.readFileSync(path.join(staged,'files',f.path));
  if(data.length>3*1024*1024||!(/^[a-f0-9]{64}$/.test(f.sha256))||hash(data)!==f.sha256)throw Error('Integridad incorrecta: '+f.path);
 }
 if(!seen.has('package.json'))throw Error('Falta package.json.');
 const next=JSON.parse(fs.readFileSync(path.join(staged,'files/package.json'),'utf8'));
 if(next.name!=='photobatch'||next.version!==to)throw Error('Version final incorrecta.');
 return manifest.files.slice().sort((a,b)=>(a.path==='package.json')-(b.path==='package.json'));
}
function apply(job,{copy=fs.copyFileSync}={}){
 const files=validate(job),backup=path.join(job.staged,'respaldo'),changed=[];
 // Complete every backup before changing any application file.
 for(const f of files){
  const target=path.join(job.appRoot,f.path);f.existed=fs.existsSync(target);
  if(f.existed){const dest=path.join(backup,f.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(target,dest);}
 }
 try{
  for(const f of files){
   const target=path.join(job.appRoot,f.path);fs.mkdirSync(path.dirname(target),{recursive:true});changed.push(f);
   copy(path.join(job.staged,'files',f.path),target);
   if(hash(fs.readFileSync(target))!==f.sha256)throw Error('No se verifico el archivo instalado: '+f.path);
  }
 }catch(error){
  const failures=[];
  for(const f of changed.reverse())try{
   const target=path.join(job.appRoot,f.path);
   if(f.existed)fs.copyFileSync(path.join(backup,f.path),target);else fs.rmSync(target,{force:true});
  }catch(e){failures.push(f.path+': '+e.message);}
  throw Error(error.message+(failures.length?' Error al restaurar: '+failures.join('; '):' Se restauro la version anterior.'));
 }
}
function restartEnvironment(){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_NO_ASAR;return env;}
async function restart(exe){
 const p=cp.spawn(exe,[],{detached:true,windowsHide:false,cwd:path.dirname(exe),env:restartEnvironment(),stdio:'ignore'});
 await new Promise((resolve,reject)=>{p.once('spawn',resolve);p.once('error',reject);});p.unref();
}
async function run(job){
 const log=message=>fs.appendFileSync(path.join(job.staged,'actualizacion.log'),`${new Date().toISOString()} ${message}\n`);
 let parentExited=false;
 try{
  log('Worker Node v2 iniciado; pid '+process.pid);
  if(!Number.isInteger(job.pid)||job.pid<=0||job.pid===process.pid)throw Error('PID padre invalido.');
  if(!job.probe)validate(job);
  fs.writeFileSync(path.join(job.staged,'ready'),'ready',{flag:'wx'});
  const deadline=Date.now()+60000;
  while(!fs.existsSync(path.join(job.staged,'go'))){if(Date.now()>deadline||!alive(job.pid))throw Error('No se recibio autorizacion del programa.');await delay(100);}
  while(alive(job.pid)){if(Date.now()>deadline)throw Error('PhotoBatch sigue abierto; no se modificaron archivos.');await delay(100);}
  parentExited=true;
  if(job.probe){fs.writeFileSync(path.join(job.staged,'probe-ok'),'OK');log('Prueba completa: arranque, confirmacion y salida del padre.');return;}
  apply(job);log('Actualizacion completada: '+job.from+' -> '+job.to);
 }catch(e){log('ERROR: '+e.stack);process.exitCode=1;}
 if(parentExited&&!job.probe)try{await restart(job.exe);log('Reapertura solicitada.');}catch(e){log('ERROR al reabrir: '+e.message);process.exitCode=1;}
}
if(require.main===module){
 try{const job=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));run(job).catch(e=>{console.error(e);process.exitCode=1;});}
 catch(e){console.error(e);process.exitCode=1;}
}
module.exports={validate,apply,run,restartEnvironment};
