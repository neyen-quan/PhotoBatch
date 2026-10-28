'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const {launchWorker}=require('./updater');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 if(process.argv[2]==='--probe-launch'){
  await launchWorker({staged:process.argv[3],exe:process.execPath,pid:process.pid,probe:true});
  return;
 }
 const root=process.argv[2],pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 if(pkg.name!=='photobatch'||!['1.2.1','1.2.2','1.2.3'].includes(pkg.version))throw Error('Esta reparacion requiere PhotoBatch 1.2.1, 1.2.2 o 1.2.3.');
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'repair-manifest.json'),'utf8'));
 for(const f of manifest){if(!['updater.js','update-worker.js'].includes(f.name))throw Error('Archivo de reparacion invalido.');const bytes=fs.readFileSync(path.join(__dirname,f.name));if(crypto.createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('La reparacion esta incompleta: '+f.name);}
 const staged=fs.mkdtempSync(path.join(os.tmpdir(),'PhotoBatch-prueba-node-'));
 console.log('Motor: '+process.execPath+'\nCarpeta: '+root+'\nPrueba: '+staged);
 const log=fs.openSync(path.join(staged,'prueba.log'),'a');let proc;
 try{proc=cp.spawn(process.execPath,[__filename,'--probe-launch',staged],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore',log,log]});}finally{fs.closeSync(log);}
 let spawnError;proc.on('error',e=>{spawnError=e;});
 const deadline=Date.now()+25000;
 while(!fs.existsSync(path.join(staged,'probe-ok'))){
  if(spawnError)throw spawnError;
  if(Date.now()>deadline){try{proc.kill();}catch{}throw Error('La prueba real de arranque no termino. No se modifico PhotoBatch. Adjunta los archivos de '+staged);}
  await sleep(100);
 }
 console.log('PRUEBA REAL CORRECTA: el proceso arranco, confirmo y continuo despues de cerrar su padre.');
 const backup=fs.mkdtempSync(path.join(root,'respaldo-actualizador-'));
 const changed=[];
 try{
  for(const f of manifest){const target=path.join(root,'app',f.name),exists=fs.existsSync(target);if(exists)fs.copyFileSync(target,path.join(backup,f.name));changed.push({target,name:f.name,exists});fs.copyFileSync(path.join(__dirname,f.name),target);if(!fs.readFileSync(target).equals(fs.readFileSync(path.join(__dirname,f.name))))throw Error('No se verifico '+f.name);}
 }catch(e){for(const f of changed.reverse()){if(f.exists)fs.copyFileSync(path.join(backup,f.name),f.target);else fs.rmSync(f.target,{force:true});}throw e;}
 console.log('REPARACION V2 COMPLETADA. Respaldo: '+backup);
 console.log('CERRA PhotoBatch y ABRILO nuevamente. La version sigue siendo '+pkg.version+'.');
 console.log('Luego usa Actualizar programa y selecciona el ZIP 1.2.1-a-1.2.4.');
}
main().catch(e=>{console.error('ERROR: '+e.stack);process.exitCode=1;});
