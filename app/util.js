'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const table=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(b){let c=0xffffffff;for(const x of b)c=table[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function syncDirectory(dir){try{const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}catch(e){if(process.platform!=='win32')throw e;}}
function durableWrite(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(path.dirname(file));}
function envelope(value){const payload=JSON.stringify(value);return JSON.stringify({schema:1,payload,sha256:hash(payload)},null,2);}
function openEnvelope(text){const e=JSON.parse(text);if(e.schema!==1||typeof e.payload!=='string'||hash(e.payload)!==e.sha256)throw Error('El historial está dañado. No se reinició la numeración.');return JSON.parse(e.payload);}
module.exports={crc32,hash,syncDirectory,durableWrite,envelope,openEnvelope};
