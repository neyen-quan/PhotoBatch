'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{unzipSync}=require('fflate');
const {VideoService,zipName,outputName}=require('../app/video');
test('video ZIPs keep order and persist ascending names across restart; a missing input publishes nothing',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-videos-test-')),downloads=path.join(dir,'Downloads'),state=path.join(dir,'userdata'),first=path.join(dir,'Uno.mp4'),second=path.join(dir,'Baño gym.mp4');
 try{fs.writeFileSync(first,Buffer.alloc(120,1));fs.writeFileSync(second,Buffer.alloc(120,2));const service=new VideoService(downloads,state);service.cleanOne=async(source,target)=>{fs.copyFileSync(source,target);return {size:120,removed:1};};let added=await service.add([first,second]);assert.equal(added.accepted.length,2);assert.equal(added.skipped,0);assert.equal(added.sequence.length,10);assert.equal(added.sequence[0],14099);assert.ok(added.sequence.every((n,i)=>i===0||n>added.sequence[i-1]));
 const expected=added.sequence.slice(0,2).map(n=>`clip_${n}.mp4`);let result=await service.clean(added.accepted.map(x=>x.id),'Mis reels');assert.equal(result.zipName,'Mis reels.zip');let zip=unzipSync(fs.readFileSync(path.join(downloads,result.zipName)));assert.deepEqual(Object.keys(zip),expected);assert.equal(zip[expected[1]].length,120);assert.equal(result.items[1].originalName,'Baño gym.mp4');assert.equal(result.items[1].name,expected[1]);assert.equal(result.sequence[0],added.sequence[1]+1);
 const next=result.sequence.slice(0,2).map(n=>`clip_${n}.mp4`),reordered=await service.clean([added.accepted[1].id,added.accepted[0].id],'Invertidos');assert.deepEqual(reordered.items.map(x=>x.originalName),['Baño gym.mp4','Uno.mp4']);assert.deepEqual(reordered.items.map(x=>x.name),next);assert.equal(outputName(483721,'Reel.MOV'),'clip_483721.mov');assert.equal(reordered.sequence[0],result.sequence[1]+1);
 fs.unlinkSync(second);await assert.rejects(service.clean(added.accepted.map(x=>x.id),'Fallido'),/Baño gym.mp4/);assert.deepEqual(fs.readdirSync(downloads),['Invertidos.zip','Mis reels.zip']);assert.equal(zipName('../mal: nombre.zip'),'.._mal_ nombre.zip');
 const restarted=new VideoService(downloads,state);restarted.cleanOne=service.cleanOne;
 const reloaded=await restarted.add([first]);assert.equal(reloaded.sequence[0],reordered.sequence[0]);
 restarted.forget(reloaded.accepted.map(v=>v.id));const readded=await restarted.add([first]);assert.equal(readded.sequence[0],reloaded.sequence[0]);
 const third=await restarted.clean(readded.accepted.map(v=>v.id),'Reiniciado');assert.deepEqual(Object.keys(unzipSync(fs.readFileSync(path.join(downloads,third.zipName)))),[`clip_${reordered.sequence[0]}.mp4`]);

 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('real video dates match selected zone and ZIP date, with chronological order and custom names',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-video-dates-')),downloads=path.join(dir,'Downloads');
 const {execFileSync}=require('node:child_process');
 const read=file=>JSON.parse(execFileSync(process.platform==='win32'?path.join(__dirname,'../vendor/exiftool/bin/exiftool.exe'):'perl',[
 ...(process.platform==='win32'?[]:[path.join(__dirname,'../node_modules/exiftool-vendored.pl/bin/exiftool')]),'-j','-G1','-a','-s','-n',file],{encoding:'utf8'}))[0];
 try{
  const source=path.join(dir,'source.mp4');fs.writeFileSync(source,Buffer.from(fs.readFileSync(path.join(__dirname,'fixtures/video.mp4.base64'),'utf8'),'base64'));
  const original=fs.readFileSync(source),service=new VideoService(downloads,path.join(dir,'state'));
  const added=await service.add([source,source]),ids=added.accepted.map(x=>x.id),config={date:'2026-11-12',from:'16:31:00',to:'16:31:01',zone:'America/Los_Angeles'};
  const result=await service.clean(ids,'',null,config);
  assert.equal(result.zipName,'Reel (12-11-2026).zip');assert.deepEqual(result.items.map(x=>x.time),['16:31:00','16:31:01']);
  const contents=unzipSync(fs.readFileSync(path.join(downloads,result.zipName)));
  for(const [i,item] of result.items.entries()){
   const out=path.join(dir,'out'+i+'.mp4');fs.writeFileSync(out,contents[item.name]);const meta=read(out);
   assert.equal(meta['QuickTime:CreateDate'],`2026:11:13 00:31:0${i}`);
   assert.equal(meta['QuickTime:ModifyDate'],`2026:11:13 00:31:0${i}`);
   assert.equal(meta['Keys:CreationDate'],`2026:11:12 16:31:0${i}-08:00`);
   assert.equal(JSON.stringify(meta).includes('remove-me'),false);
   for(const [key,value] of Object.entries(meta))if(/:(Track|Media)(Create|Modify)Date$/.test(key))assert.equal(value,`2026:11:13 00:31:0${i}`);
  }
  assert.deepEqual(fs.readFileSync(source),original);
  const summer=await service.clean([ids[1]],'Mi reel',null,{...config,date:'2026-07-12',from:'16:31:00',to:'16:31:00'});
  assert.equal(summer.zipName,'Mi reel.zip');assert.equal(summer.items[0].offset,'-07:00');
  const duplicate=await service.clean([ids[0]],'',null,config);assert.equal(duplicate.zipName,'Reel (12-11-2026)-2.zip');
  const before=fs.readdirSync(downloads);await assert.rejects(service.clean(ids,'No guardar',null,{...config,to:'16:31:00'}),/segundo por archivo/);
  await assert.rejects(service.clean(ids,'No guardar',null,{...config,date:'2026-02-30'}),/fecha válida/);assert.deepEqual(fs.readdirSync(downloads),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
