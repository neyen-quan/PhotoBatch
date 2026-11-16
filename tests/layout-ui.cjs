'use strict';
const {_electron:electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pb-layout-'));let app;const errors=[];
 try{
  app=await electron.launch({args:[path.resolve('.')],env:{...process.env,PHOTOBATCH_TEST_ROOT:root}});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#slots .slot');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setMinimumSize(0,0));
  assert.equal(await page.locator('.logo').evaluate(image=>image.complete&&image.naturalWidth>0),true,'brand asset loads through app protocol');
  assert.equal(await page.locator('#copyButton,.copy-panel').count(),0);
  assert.equal(await page.evaluate(()=>typeof window.photoBatch.createCopy),'undefined');
  for(let i=0;i<10;i++)await page.evaluate(async file=>{const p=await window.photoBatch.importPath(file);slots[slots.indexOf(null)]={...p,camera:'back'};render();},path.resolve('tests/fixtures/normal.jpg'));
  await require('./renderer-ui.cjs')(page);
  await page.locator('#previewButton').click();await page.waitForFunction(()=>!document.getElementById('exportButton').disabled);
  const verify=async(mode,w,h)=>{
   await app.evaluate(({BrowserWindow},{w,h})=>BrowserWindow.getAllWindows()[0].setContentSize(w,h),{w,h});
   await page.waitForTimeout(200);
   const result=await page.evaluate(mode=>{const aside=document.querySelector('aside'),button=document.querySelector(mode==='photo'?'#exportButton':'#videoClean'),r=button.getBoundingClientRect();return {width:innerWidth,height:innerHeight,document:document.documentElement.scrollHeight,aside:aside.scrollHeight-aside.clientHeight,bottom:r.bottom,visible:document.elementFromPoint(r.x+10,r.y+10)===button,slots:[...document.querySelectorAll((mode==='photo'?'#slots':'#videoSlots')+' .slot')].map(e=>e.getBoundingClientRect().height)};},mode);
   console.log(mode,w,h,JSON.stringify(result));assert.ok(result.height===h,'requested viewport height');assert.ok(result.document<=result.height+1,'page scroll');assert.ok(result.aside<=1,'settings scroll');assert.ok(result.bottom<=result.height,'export below viewport');assert.ok(result.visible,'export obscured');assert.ok(result.slots.every(h=>h>=140),'cards too small');
  };
  for(const [w,h] of [[1360,920],[1200,800],[1020,710]])await verify('photo',w,h);
  await verify('photo',1360,920);fs.mkdirSync('tests/layout-shots',{recursive:true});await page.screenshot({path:'tests/layout-shots/photos.png'});
  await page.locator('#exportButton').click();await page.waitForSelector('#result:not([hidden])',{timeout:120000});await verify('photo',1360,920);await verify('photo',1020,710);
  await page.locator('#historyButton').click();
  await page.waitForSelector('#modal[open]');
  assert.match(await page.locator('#modalBody').textContent(),/1 tandas guardadas/);
  await page.keyboard.press('Escape');
  await page.locator('#videoMode').click();
  const videoFixture=path.join(root,'sample.mp4');
  fs.writeFileSync(videoFixture,Buffer.from(fs.readFileSync('tests/fixtures/video.mp4.base64','utf8'),'base64'));
  await app.evaluate(({dialog},file)=>{
   globalThis.originalPicker=dialog.showOpenDialog;
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file,file]});
  },videoFixture);
  await page.locator('#videoPick').click();
  await page.waitForFunction(()=>document.querySelectorAll('#videoSlots .filled').length===2);
  await app.evaluate(({dialog})=>{dialog.showOpenDialog=globalThis.originalPicker;delete globalThis.originalPicker;});
  await page.locator('#videoClean').click();
  await page.waitForSelector('#videoResult:not([hidden])',{timeout:120000});
  assert.match(await page.locator('#videoResultDetail').textContent(),/2 videos verificados/);
  assert.equal(fs.readdirSync(path.join(root,'Downloads')).filter(name=>name.endsWith('.zip')).length,2);
  await verify('video',1020,710);
  await page.locator('#videoClear').click();
  await page.waitForFunction(()=>document.querySelectorAll('#videoSlots .filled').length===0);
  await page.evaluate(()=>{videoSequence=Array.from({length:10},(_,i)=>14099+i*3);videoSlots=videoSequence.map((n,i)=>({id:String(i),name:'original-'+i+'.mp4',size:1024}));renderVideos();});
  for(const [w,h] of [[1360,920],[1200,800],[1020,710]])await verify('video',w,h);
  await verify('video',1360,920);await page.screenshot({path:'tests/layout-shots/videos.png'});assert.deepEqual(errors,[]);console.log('LAYOUT PASS: photo preview, export, video, no scrolling, no AI IPC.');
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
})().catch(e=>{console.error(e);process.exitCode=1});
