'use strict';
const fs=require('node:fs'),path=require('node:path');const {hash,envelope,openEnvelope,durableWrite,syncDirectory}=require('./util');
function validate(r){if(r.schema!==1||!/^[-a-zA-Z0-9]+$/.test(r.id)||!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<r.start||r.end>999999999||!Array.isArray(r.items)||!r.items.length||r.items.length>10||!/^[0-9a-f]{64}$/.test(r.zipHash))throw Error('Registro de historial inválido.');let prev=r.start-1;for(const x of r.items){if(!Number.isInteger(x.number)||x.number<=prev||x.number>r.end)throw Error('Números inválidos en el historial.');prev=x.number;}return r;}
class History{
 constructor(dir){this.dir=dir;fs.mkdirSync(dir,{recursive:true});this.recover();}
 recover(){for(const n of fs.readdirSync(this.dir).filter(x=>x.endsWith('.pending'))){const f=path.join(this.dir,n),r=validate(openEnvelope(fs.readFileSync(f,'utf8')));if(fs.existsSync(r.zipPath)){if(hash(fs.readFileSync(r.zipPath))!==r.zipHash)throw Error('Hay una exportación interrumpida cuyo ZIP cambió. Revisá el historial.');this.commit(r.id);}else fs.unlinkSync(f);}}
 list(){const rows=fs.readdirSync(this.dir).filter(x=>x.endsWith('.json')).map(n=>validate(openEnvelope(fs.readFileSync(path.join(this.dir,n),'utf8')))).sort((a,b)=>a.start-b.start);for(let i=1;i<rows.length;i++)if(rows[i].start<=rows[i-1].end)throw Error('El historial contiene rangos superpuestos.');return rows;}
 summary(){const rows=this.list();return {highWater:rows.at(-1)?.end??-1,last:rows.at(-1)??null,count:rows.length,recent:rows.slice(-20).reverse()};}
 prepare(r){validate(r);if(r.start<=this.summary().highWater)throw Error('El rango ya fue usado. Generá una nueva vista previa.');durableWrite(path.join(this.dir,r.id+'.pending'),envelope(r));}
 commit(id){fs.renameSync(path.join(this.dir,id+'.pending'),path.join(this.dir,id+'.json'));syncDirectory(this.dir);}
 backup(){return envelope({schema:1,kind:'PhotoBatch-history',receipts:this.list()});}
 restore(text){const b=openEnvelope(text);if(b.kind!=='PhotoBatch-history'||b.schema!==1||!Array.isArray(b.receipts)||b.receipts.length>100000)throw Error('Respaldo no válido.');const map=new Map(this.list().map(r=>[r.id,r])),add=[];for(const raw of b.receipts){const r=validate(raw);if(map.has(r.id)){if(JSON.stringify(map.get(r.id))!==JSON.stringify(r))throw Error('El respaldo contradice un registro existente.');continue;}map.set(r.id,r);add.push(r);}const all=[...map.values()].sort((a,b)=>a.start-b.start);for(let i=1;i<all.length;i++)if(all[i].start<=all[i-1].end)throw Error('El respaldo contiene rangos ya utilizados.');for(const r of add)durableWrite(path.join(this.dir,r.id+'.json'),envelope(r));return add.length;}
}
module.exports={History};
