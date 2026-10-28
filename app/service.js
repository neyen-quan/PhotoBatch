'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const {Zip,ZipPassThrough,unzipSync}=require('fflate');
const {inspect}=require('./image-container'),{makePlan}=require('./batch'),{History}=require('./history'),{transform}=require('./metadata'),{hash,durableWrite,syncDirectory}=require('./util');
class BatchService{
 constructor({stateDir,tempDir,downloads,onProgress=()=>{}}){this.history=new History(stateDir);this.tempDir=tempDir;this.downloads=downloads;this.onProgress=onProgress;this.sources=new Map();this.plan=null;this.busy=false;fs.mkdirSync(tempDir,{recursive:true});fs.mkdirSync(downloads,{recursive:true});}
 async importFile(file,displayName){if(this.busy)throw Error('Esperá a que termine la exportación.');const stat=await fs.promises.stat(file);if(!stat.isFile()||stat.size>100*1024*1024)throw Error('Cada imagen debe pesar como máximo 100 MiB.');const b=await fs.promises.readFile(file),info=inspect(b),extension=path.extname(displayName||file),allowed={png:['.png'],jpeg:['.jpg','.jpeg'],webp:['.webp']}[info.format];if(!allowed.includes(extension.toLowerCase()))throw Error('La extensión no coincide con el formato real.');const id=crypto.randomUUID(),source={id,path:file,name:path.basename(displayName||file),extension,size:b.length,width:info.width,height:info.height,hash:hash(b),format:info.format};this.sources.set(id,source);return {...source,path:undefined,hash:undefined};}
 forget(ids){if(this.busy)return;for(const id of ids){const s=this.sources.get(id);if(s&&path.dirname(s.path)===this.tempDir)try{fs.unlinkSync(s.path);}catch{}this.sources.delete(id);}this.plan=null;}
 preview(config,items){if(this.busy)throw Error('Hay una exportación en curso.');if(new Set(items.map(x=>x.id)).size!==items.length)throw Error('Una imagen está duplicada en el lote.');let total=0;const entries=items.map(x=>{const s=this.sources.get(x.id);if(!s)throw Error('Volvé a cargar las imágenes.');total+=s.size;return {...s,camera:x.camera};});if(total>500*1024*1024)throw Error('El lote supera los 500 MiB.');this.plan=makePlan(config,entries,this.history.summary().highWater);this.plan.token=crypto.randomUUID();return this.plan;}
 async export(token,customName=""){
  if(this.busy)throw Error('Hay una exportación en curso.');if(!this.plan||this.plan.token!==token)throw Error('Generá una vista previa actualizada.');
  const plan=JSON.parse(JSON.stringify(this.plan)),id=crypto.randomUUID(),dir=path.join(this.tempDir,id);fs.mkdirSync(dir);
  const defaultName=`PhotoBatch_${plan.config.start}-${plan.config.end}_${plan.config.date}_${id.slice(0,8)}`;
  if(typeof customName!=='string'||customName.length>160)throw Error('Nombre ZIP demasiado largo.');
  let basename=customName.trim().replace(/\.zip$/i,'')||defaultName;
  if(basename==='.'||basename==='..'||/[<>:"/\\|?*\x00-\x1f]/.test(basename)||/[. ]$/.test(basename)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(basename))throw Error('Nombre ZIP inválido para Windows.');
  let zipName=basename+'.zip',suffix=2;
  while(fs.existsSync(path.join(this.downloads,zipName))){zipName=basename+' ('+(suffix++)+').zip';if(suffix>100000)throw Error('No se encontró un nombre disponible.');}
  const zipPath=path.join(this.downloads,zipName),partial=path.join(this.downloads,'.'+id+'.partial');let fd,prepared=false,published=false;this.busy=true;
  try{
   if(plan.config.start<=this.history.summary().highWater)throw Error('Este rango ya fue utilizado.');fd=fs.openSync(partial,'wx');let zipError=null;const zip=new Zip((err,data)=>{if(err){zipError=err;return;}fs.writeSync(fd,data);}),reports=[];
   for(let i=0;i<plan.items.length;i++){
    const item=plan.items[i],source=this.sources.get(item.id);if(!source)throw Error('Falta una imagen.');this.onProgress({current:i+1,total:plan.items.length,name:item.name});
    const r=await transform(source.path,path.join(dir,item.name),item,source.hash);reports.push({...r.report,sourceName:source.name});
    const entry=new ZipPassThrough(item.name),[y,m,d]=item.date.split('-').map(Number),[h,min,s]=item.time.split(':').map(Number);entry.mtime=new Date(y,m-1,d,h,min,s);zip.add(entry);entry.push(r.bytes,true);if(zipError)throw zipError;
   }
   zip.end();if(zipError)throw zipError;fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   const zipBytes=fs.readFileSync(partial),entries=unzipSync(zipBytes);if(Object.keys(entries).length!==reports.length)throw Error('Falló la verificación del ZIP.');for(const r of reports)if(hash(entries[r.name])!==r.exportedSHA256)throw Error('El ZIP contiene una imagen diferente.');
   const receipt={schema:1,id,createdAt:new Date().toISOString(),start:plan.config.start,end:plan.config.end,date:plan.config.date,from:plan.config.from,to:plan.config.to,zone:plan.config.zone,zipPath,zipName,zipHash:hash(zipBytes),items:plan.items.map((x,i)=>({...x,sourceName:reports[i].sourceName,verified:true,imageSHA256:reports[i].imageSHA256,exportedSHA256:reports[i].exportedSHA256})),reports};
   this.history.prepare(receipt);prepared=true;
   // Atomic publication without replacing an existing ZIP (NTFS and POSIX).
   fs.linkSync(partial,zipPath);published=true;fs.unlinkSync(partial);syncDirectory(this.downloads);this.history.commit(id);this.plan=null;return {receipt,history:this.history.summary()};
  }catch(e){if(published){this.plan=null;throw Error('El ZIP se guardó, pero falta confirmar el historial. Cerrá y abrí PhotoBatch antes de moverlo. '+e.message);}if(prepared)try{fs.unlinkSync(path.join(this.history.dir,id+'.pending'));}catch{}throw e;}
  finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(partial);}catch{}fs.rmSync(dir,{recursive:true,force:true});this.busy=false;}
 }
 backup(){const f=path.join(this.downloads,'PhotoBatch_historial_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');durableWrite(f,this.history.backup());return f;}
}
module.exports={BatchService};
