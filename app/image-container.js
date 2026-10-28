'use strict';
const {crc32,hash}=require('./util');
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const KEEP_PNG=new Set(['IHDR','PLTE','IDAT','IEND','tRNS','cHRM','gAMA','iCCP','sRGB','sBIT','bKGD','pHYs','cICP','mDCV','cLLI']);
const fail=m=>{throw Error(m);};
function pngChunk(type,data){const t=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([t,data])),8+data.length);return out;}
function png(b){
 let pos=8,width,height,ended=false,idats=0,parts=[],removed=[];
 while(pos<b.length){
  if(pos+12>b.length)fail('PNG incompleto.');
  const len=b.readUInt32BE(pos),end=pos+12+len;if(end>b.length)fail('Bloque PNG incompleto.');
  const type=b.toString('ascii',pos+4,pos+8),data=b.subarray(pos+8,pos+8+len),raw=b.subarray(pos,end);
  if(crc32(b.subarray(pos+4,pos+8+len))!==b.readUInt32BE(pos+8+len))fail('PNG con un bloque dañado (CRC): '+type);
  if(!parts.length&&type!=='IHDR')fail('PNG sin cabecera inicial.');
  if(type==='IHDR'){if(len!==13||width!==undefined)fail('Cabecera PNG inválida.');width=data.readUInt32BE(0);height=data.readUInt32BE(4);}
  if(['acTL','fcTL','fdAT'].includes(type))fail('Las imágenes animadas no se admiten en esta versión.');
  if(!KEEP_PNG.has(type)&&type[0]===type[0].toUpperCase())fail('PNG con bloque crítico no compatible: '+type);
  if(KEEP_PNG.has(type))parts.push(raw);else removed.push(type);
  if(type==='IDAT')idats++;pos=end;
  if(type==='IEND'){if(len)fail('Final PNG inválido.');ended=true;break;}
 }
 if(!ended||!idats)fail('PNG sin datos completos.');if(pos<b.length)removed.push('Datos posteriores a IEND');
 return {format:'png',width,height,clean:Buffer.concat([SIGNATURE,...parts]),fingerprint:hash(Buffer.concat(parts)),removed};
}
function jpeg(b){
 let pos=2,parts=[b.subarray(0,2)],visual=[],removed=[],width,height,ended=false,scans=0;
 while(pos<b.length){
  const begin=pos;if(b[pos]!==255)fail('Marcador JPEG inválido.');while(b[pos]===255)pos++;if(pos>=b.length)fail('JPEG incompleto.');const marker=b[pos++];
  if(marker===217){const r=Buffer.from([255,217]);parts.push(r);visual.push(r);ended=true;break;}
  if(marker===0||marker===216||marker===1||(marker>=208&&marker<=215))fail('Estructura JPEG no compatible.');
  if(pos+2>b.length)fail('Segmento JPEG incompleto.');const len=b.readUInt16BE(pos);if(len<2||pos+len>b.length)fail('Longitud JPEG inválida.');
  const data=b.subarray(pos+2,pos+len),raw=b.subarray(begin,pos+len);pos+=len;
  if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){if(data.length<6)fail('Dimensiones JPEG inválidas.');height=data.readUInt16BE(1);width=data.readUInt16BE(3);}
  if((marker>=224&&marker<=239)||marker===254){
   if(marker===226&&data.subarray(0,4).toString()==='MPF\0')fail('JPEG con imágenes auxiliares/HDR: pendiente de soporte. El original se conserva.');
   if(marker===225&&/hdrgainmap|HDRGainMap|hdrgm:/.test(data.toString('latin1')))fail('JPEG con mapa HDR: pendiente de soporte.');
   if((marker===226&&data.subarray(0,12).toString()==='ICC_PROFILE\0')||(marker===238&&data.subarray(0,5).toString()==='Adobe')){parts.push(raw);visual.push(raw);}
   else if(marker===224&&data.subarray(0,5).toString()==='JFIF\0'){
    if(data.length<14)fail('JFIF inválido.');const d=Buffer.from(data.subarray(0,14));d[12]=0;d[13]=0;const r=Buffer.alloc(18);r[0]=255;r[1]=224;r.writeUInt16BE(16,2);d.copy(r,4);parts.push(r);visual.push(r);if(data.length>14)removed.push('Miniatura JFIF');
   }else removed.push(marker===254?'Comentario JPEG':'APP'+(marker-224));
  }else{parts.push(raw);visual.push(raw);}
  if(marker===218){scans++;const start=pos;while(pos<b.length){if(b[pos]!==255){pos++;continue;}let q=pos+1;while(q<b.length&&b[q]===255)q++;if(q>=b.length)fail('Escaneo JPEG incompleto.');if(b[q]===0||(b[q]>=208&&b[q]<=215)){pos=q+1;continue;}break;}const scan=b.subarray(start,pos);parts.push(scan);visual.push(scan);}
 }
 if(!ended||!scans||!width||!height)fail('JPEG sin imagen completa.');if(pos<b.length)removed.push('Datos posteriores a EOI');
 return {format:'jpeg',width,height,clean:Buffer.concat(parts),fingerprint:hash(Buffer.concat(visual)),removed};
}
function webp(b){
 if(b.readUInt32LE(4)+8!==b.length)fail('Longitud WebP incorrecta.');let pos=12,parts=[],visual=[],removed=[],width,height,images=0;
 while(pos<b.length){
  if(pos+8>b.length)fail('WebP incompleto.');const type=b.toString('ascii',pos,pos+4),len=b.readUInt32LE(pos+4),end=pos+8+len+(len%2);if(end>b.length)fail('Bloque WebP incompleto.');
  const data=b.subarray(pos+8,pos+8+len),raw=Buffer.from(b.subarray(pos,end));
  if(['ANIM','ANMF'].includes(type))fail('Las imágenes animadas no se admiten en esta versión.');
  if(type==='VP8X'){if(len!==10)fail('VP8X inválido.');if(data[0]&2)fail('WebP animado no compatible.');width=1+data.readUIntLE(4,3);height=1+data.readUIntLE(7,3);raw[8]&=~12;parts.push(raw);}
  else if(['VP8 ','VP8L','ALPH','ICCP'].includes(type)){
   parts.push(raw);visual.push(raw);
   if(type==='VP8 '){images++;if(len<10||data[3]!==157||data[4]!==1||data[5]!==42)fail('VP8 inválido.');width??=data.readUInt16LE(6)&16383;height??=data.readUInt16LE(8)&16383;}
   if(type==='VP8L'){images++;if(len<5||data[0]!==47)fail('VP8L inválido.');const n=data.readUInt32LE(1);width??=1+(n&16383);height??=1+((n>>>14)&16383);}
  }else removed.push(type);pos=end;
 }
 if(images!==1||!width||!height)fail('WebP sin imagen válida.');const payload=Buffer.concat(parts),h=Buffer.alloc(12);h.write('RIFF');h.writeUInt32LE(payload.length+4,4);h.write('WEBP',8);
 return {format:'webp',width,height,clean:Buffer.concat([h,payload]),fingerprint:hash(Buffer.concat(visual)),removed};
}
function inspect(b){
 if(!Buffer.isBuffer(b)||b.length<12)fail('Archivo vacío o no compatible.');let r;
 if(b.subarray(0,8).equals(SIGNATURE))r=png(b);else if(b[0]===255&&b[1]===216)r=jpeg(b);else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')r=webp(b);else fail('Usá PNG, JPG/JPEG o WebP estáticos.');
 if(!r.width||!r.height||r.width*r.height>80000000)fail('La imagen supera el límite de 80 megapíxeles.');return r;
}
function verifyImage(before,after){const a=inspect(before),b=inspect(after);if(a.format!==b.format||a.width!==b.width||a.height!==b.height||a.fingerprint!==b.fingerprint)fail('Verificación fallida: cambiaron datos de la imagen. No se exportó.');return {format:a.format,width:a.width,height:a.height,imageSHA256:a.fingerprint};}
module.exports={inspect,verifyImage,pngChunk};
