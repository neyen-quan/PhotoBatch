'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Cloud,URL}=require('../app/cloud');
const {BatchService}=require('../app/service');
const {VideoService}=require('../app/video');
const {fakeCloud}=require('./fake-cloud.cjs');
const key=crypto.randomBytes(32);
const storage={isAsyncEncryptionAvailable:async()=>true,getSelectedStorageBackend:()=> 'test',
  encryptStringAsync:async text=>{const iv=crypto.randomBytes(16),c=crypto.createCipheriv('aes-256-cbc',key,iv);return Buffer.concat([iv,c.update(text),c.final()]);},
  decryptStringAsync:async bytes=>{const d=crypto.createDecipheriv('aes-256-cbc',key,bytes.subarray(0,16));return {result:Buffer.concat([d.update(bytes.subarray(16)),d.final()]).toString(),shouldReEncrypt:false};}};
function setup(t,backend=fakeCloud(),local={photo:-1,video:14098}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-cloud-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cloud=new Cloud({stateDir:dir,secureStorage:storage,localCounters:()=>local});cloud.request=backend.request;
  return {cloud,backend,dir,local};
}
test('two devices merge floors, reserve exclusively, retry idempotently, and never go backwards',async t=>{
  const a=setup(t),b=setup(t,a.backend,{photo:1699,video:14150});
  await a.cloud.signIn('a@example.test','password');await b.cloud.signIn('a@example.test','password');
  assert.deepEqual((await a.cloud.sync()).counters,{photo:1699,video:14150});
  const req=crypto.randomUUID();await a.cloud.reserve('photo',1700,1799,req);
  await a.cloud.reserve('photo',1700,1799,req);assert.equal(a.backend.reservations.size,1);
  await assert.rejects(b.cloud.reserve('photo',1700,1799,crypto.randomUUID()),/avanzó/);
  assert.equal((await b.cloud.sync()).counters.photo,1799);
  b.local.photo=2499;assert.equal((await b.cloud.sync()).counters.photo,2499);
  assert.equal((await a.cloud.sync({photo:1700,video:14099})).counters.photo,2499);
  await assert.rejects(a.cloud.reserve('photo',1800,1899,req),/diferente/);
});
test('session is encrypted, restored and refreshed once; logout keeps other sessions and counters',async t=>{
  const {cloud,dir,backend}=setup(t);await cloud.signIn('a@example.test','super-password');
  const bytes=fs.readFileSync(cloud.file);assert.ok(!bytes.includes('test-refresh'));assert.ok(!bytes.includes('super-password'));
  assert.ok(!JSON.stringify(cloud.snapshot()).includes('test-access'));
  const restored=new Cloud({stateDir:dir,secureStorage:storage,localCounters:()=>({photo:-1,video:14098})});restored.request=backend.request;
  await restored.load();restored.session.expires_at=0;
  await Promise.all([restored.sync(),restored.sync()]);
  assert.equal(backend.calls.filter(x=>x.route.includes('grant_type=refresh_token')).length,1);
  await restored.signOut();assert.ok(!fs.existsSync(cloud.file));
  assert.equal((await cloud.sync()).signedIn,true);assert.ok(backend.calls.some(x=>x.route.includes('scope=local')));
});
test('no session and no network cannot allocate; confirmation accepts only PhotoBatch links',async t=>{
  const {cloud,backend}=setup(t);
  await assert.rejects(cloud.reserve('photo',1,10,crypto.randomUUID()),/Iniciá sesión/);
  await cloud.signIn('a@example.test','password');backend.setOffline(true);
  await assert.rejects(cloud.reserve('photo',1,10,crypto.randomUUID()),/Sin conexión/);assert.equal(backend.reservations.size,0);
  backend.setOffline(false);
  await assert.rejects(cloud.verifyLink('https://evil.test/auth/v1/verify?type=signup&token=abcdefgh12345678'),/no corresponde/);
  await assert.rejects(cloud.verifyLink(URL+'/auth/v1/verify?type=recovery&token=abcdefgh12345678','short'),/10 caracteres/);
  await cloud.verifyLink(URL+'/auth/v1/verify?type=signup&token=abcdefgh12345678');
  assert.equal(backend.calls.find(x=>x.route.endsWith('/verify')).body.token_hash,'abcdefgh12345678');
});
test('lost reservation response consumes the range safely and a retry does not allocate twice',async t=>{
  const {cloud,backend}=setup(t);await cloud.signIn('a@example.test','password');
  let lost=true;cloud.request=async(...args)=>{const result=await backend.request(...args);if(lost&&args[0].endsWith('reserve_numbers')){lost=false;throw Error('lost reply');}return result;};
  const id=crypto.randomUUID();await assert.rejects(cloud.reserve('photo',1700,1799,id),/lost reply/);
  await cloud.reserve('photo',1700,1799,id);assert.equal(backend.reservations.size,1);
  assert.equal((await cloud.sync()).counters.photo,1799);
});
test('corrupt saved counters fail closed instead of resetting; expired session is removed',async t=>{
  const {cloud,dir}=setup(t);await cloud.signIn('a@example.test','password');
  cloud.session.expires_at=0;cloud.request=async()=>{const e=Error('expired');e.status=400;throw e;};
  await assert.rejects(cloud.sync(),/sesión venció/);assert.equal(cloud.session,null);assert.ok(!fs.existsSync(cloud.file));
  fs.writeFileSync(cloud.counterFile,'broken');
  const corrupt = new Cloud({stateDir:dir});
  await assert.rejects(corrupt.sync(),/dañado/);
  await assert.rejects(corrupt.reserve('photo',1700,1799,crypto.randomUUID()),/dañado/);
});
test('real HTTP transport uses publishable key, rejects redirects, reports errors without tokens',async t=>{
  const {dir}=setup(t);const calls=[];
  const c=new Cloud({stateDir:dir,localCounters:()=>({photo:-1,video:14098}),fetchImpl:async(url,options)=>{
    calls.push({url,options});return new Response(JSON.stringify({error_code:'invalid_credentials'}),{status:400});
  }});
  await assert.rejects(c.signIn('a@example.test','secret-password'),/Correo o contraseña/);
  assert.equal(calls[0].options.redirect,'error');assert.ok(calls[0].options.headers.apikey.startsWith('sb_publishable_'));
  c.fetch=async()=>{throw Error('socket error');};
  await assert.rejects(c.signIn('a@example.test','secret-password'),/Revisá Internet/);
});
test('photo ZIP is never published when cloud rejects reservation; retries keep the same request ID',async t=>{
  const {dir}=setup(t);const calls=[];let denied=true;
  const service=new BatchService({stateDir:path.join(dir,'history'),tempDir:path.join(dir,'tmp'),downloads:path.join(dir,'Downloads'),
    reserveNumbers:async(...args)=>{calls.push(args);if(denied)throw Error('cloud rejected');}});
  const photo=await service.importFile(path.join(__dirname,'fixtures','normal.jpg'));
  const plan=service.preview({start:1700,size:100,date:'2026-11-16',from:'17:00',to:'17:20',zone:'UTC'},[{id:photo.id}]);
  await assert.rejects(service.export(plan.token),/cloud rejected/);
  assert.equal(fs.readdirSync(service.downloads).filter(n=>n.endsWith('.zip')).length,0);assert.equal(service.history.summary().highWater,-1);
  denied=false;await service.export(plan.token);
  assert.equal(calls[0][3],calls[1][3]);assert.equal(service.history.summary().highWater,1799);
});
test('video ZIP is never published when cloud rejects its reservation',async t=>{
  const {dir}=setup(t);const file=path.join(dir,'clip.mp4');
  fs.writeFileSync(file,Buffer.from(fs.readFileSync(path.join(__dirname,'fixtures','video.mp4.base64'),'utf8'),'base64'));
  const service=new VideoService(path.join(dir,'Downloads'),dir,async()=>{throw Error('cloud rejected');});
  const result=await service.add([file]);
  await assert.rejects(service.clean(result.accepted.map(x=>x.id),'',null,{date:'2026-11-16',from:'17:00',to:'17:20',zone:'UTC'}),/cloud rejected/);
  assert.equal(fs.readdirSync(service.downloads).filter(n=>n.endsWith('.zip')).length,0);assert.ok(!fs.existsSync(service.sequenceFile));
});
