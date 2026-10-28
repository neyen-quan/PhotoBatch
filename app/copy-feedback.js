'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hash,syncDirectory}=require('./util');
const normalize=text=>String(text).trim().toLocaleLowerCase('en').replace(/[^a-z0-9]+/g,' ').trim();
function parse(text){
 const data=JSON.parse(text),payload=JSON.stringify(data.entries);
 if(data.schema!==1||!Array.isArray(data.entries)||data.entries.length>2000||data.sha256!==hash(payload))throw Error('Preferencias de copy dañadas.');
 const entries=new Map();
 for(const entry of data.entries){
  if(!entry||typeof entry.text!=='string'||entry.text.length>180||!entry.text.trim()||![1,-1].includes(entry.rating))throw Error('Preferencias de copy inválidas.');
  entries.set(normalize(entry.text),{text:entry.text,rating:entry.rating});
 }
 return entries;
}
class CopyFeedback{
 constructor(file){this.file=file;this.entries=new Map();
  if(fs.existsSync(file)){
   try{this.entries=parse(fs.readFileSync(file,'utf8'));}
   catch(e){
    const backup=file+'.bak';
    if(!fs.existsSync(backup))throw Error('No se pudieron leer las preferencias de copy: '+e.message);
    try{this.entries=parse(fs.readFileSync(backup,'utf8'));}
    catch{throw Error('Las preferencias de copy y su respaldo están dañados. No se sobrescribieron.');}
   }
  }
 }
 rating(text){return this.entries.get(normalize(text))?.rating||0;}
 examples(rating,limit=12){return [...this.entries.values()].filter(e=>e.rating===rating).slice(-limit).map(e=>e.text);}
 negative(text){const target=normalize(text);return this.entries.get(target)?.rating===-1;}
 rate(text,rating){
  if(typeof text!=='string'||!text.trim()||text.length>180||/[\r\n\x00-\x1f]/.test(text)||![1,0,-1].includes(rating))throw Error('Valoración no válida.');
  const key=normalize(text);if(!key)throw Error('Valoración no válida.');
  const updated=new Map(this.entries);updated.delete(key);
  if(rating)updated.set(key,{text:text.trim(),rating});
  while(updated.size>1000)updated.delete(updated.keys().next().value);
  const entries=[...updated.values()],payload=JSON.stringify(entries);
  const data=JSON.stringify({schema:1,entries,sha256:hash(payload)});
  fs.mkdirSync(path.dirname(this.file),{recursive:true});
  const tmp=this.file+'.tmp';
  try{
   fs.writeFileSync(tmp,data,{flag:'w'});
   const fd=fs.openSync(tmp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   // Keep the last valid generation until the new one is safely in place.
   if(fs.existsSync(this.file)){
    try{parse(fs.readFileSync(this.file,'utf8'));fs.copyFileSync(this.file,this.file+'.bak');}catch{}
   }
   fs.renameSync(tmp,this.file);syncDirectory(path.dirname(this.file));this.entries=updated;
  }finally{try{fs.rmSync(tmp,{force:true});}catch{}}
  return rating;
 }
}
module.exports={CopyFeedback,normalize};
