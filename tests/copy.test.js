'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {CopyService,parseCaptions,chat}=require('../app/copy');
const {CopyFeedback}=require('../app/copy-feedback');
const options=n=>Array.from({length:5},(_,i)=>`A quiet afternoon ${n} option ${i}.`);
test('all photos contribute, regeneration reuses vision and excludes earlier captions',async()=>{
 const calls=[];let round=0;const s=new CopyService({request:async p=>{calls.push(p);return p.format?JSON.stringify({captions:options(++round)}):'Visible books and a coffee cup.';}});
 const images=[{id:'one',base64:'a'},{id:'two',base64:'b'},{id:'three',base64:'c'}];
 assert.deepEqual(await s.generate(images),options(1));assert.equal(calls.length,4);
 assert.ok(calls.slice(0,3).every(p=>p.messages[0].images.length===1));
 assert.match(calls[3].messages[1].content,/Photo 3:/);assert.ok(calls.slice(0,3).every(p=>p.model==='qwen3-vl:4b-instruct'&&p.think===undefined&&p.stream===false));assert.equal(calls[3].model,'qwen3:8b');assert.equal(calls[3].think,false);
 await s.generate(images);assert.equal(calls.length,5);assert.match(calls[4].messages[1].content,/afternoon 1 option 0/);
 await s.generate([images[2],images[0]]);assert.equal(calls.length,6);assert.ok(!calls[5].messages[1].content.includes('afternoon 1 option 0'));
 assert.equal(s.scenes.has('two'),false);
});
test('failure and concurrent clicks leave service usable',async()=>{
 let finish;const s=new CopyService({request:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=s.generate([{id:'a',base64:'x'}]);await assert.rejects(s.generate([{id:'b'}]),/Ya se/);
 s.request=async()=>'';finish('');await assert.rejects(pending,/describir/);assert.equal(s.busy,false);
 s.request=async()=>{throw Error('model not found');};await assert.rejects(s.generate([{id:'a',base64:'x'}]),/ollama pull/);assert.equal(s.busy,false);
});
test('invalid, duplicate and repeated outputs are rejected',async()=>{
 assert.throws(()=>parseCaptions('<think>secret</think>{"captions":["a"]}'));
 assert.throws(()=>parseCaptions(JSON.stringify({captions:['a','a','b','c','d']})));
 assert.deepEqual(parseCaptions('<think>ignore me</think>'+JSON.stringify({captions:options(1)})),options(1));
 const s=new CopyService({request:async p=>p.format?JSON.stringify({captions:options(1)}):'Coffee.'});
 await s.generate([{id:'a',base64:'x'}]);await assert.rejects(s.generate([{id:'a'}]),/repitió/);
});
test('real HTTP transport uses fixed loopback and reports connection/model errors',async()=>{
 const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{assert.equal(req.url,'/api/chat');const p=JSON.parse(body);res.setHeader('Content-Type','application/json');if(p.truncated){res.end(JSON.stringify({done:true,done_reason:'length',eval_count:1200,message:{content:'partial'}}));}else if(p.fail){res.statusCode=404;res.end(JSON.stringify({error:'model not found'}));}else res.end(JSON.stringify({done:true,message:{content:'ok'}}));});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(11434,'127.0.0.1',resolve);});
 try{assert.equal(await chat({model:'mock'}),'ok');await assert.rejects(chat({fail:true}),/model not found/);await assert.rejects(chat({truncated:true}),e=>e.code==='OLLAMA_TRUNCATED'&&e.detail.eval_count===1200);}finally{await new Promise(r=>server.close(r));}
 await assert.rejects(chat({}),/Abrí Ollama/);
});

test('truncated vision and caption responses retry automatically with larger budget',async()=>{
 let vision=0,writing=0;const payloads=[],progress=[];
 const s=new CopyService({request:async p=>{payloads.push(p);if(p.format){if(++writing===1){const e=Error('cut');e.code='OLLAMA_TRUNCATED';throw e;}return JSON.stringify({captions:options(2)});}
 if(++vision===1){const e=Error('cut');e.code='OLLAMA_TRUNCATED';throw e;}return 'A coffee cup and books.';}});
 assert.deepEqual(await s.generate([{id:'a',base64:'photo'}],p=>progress.push(p)),options(2));assert.equal(vision,2);assert.equal(writing,2);
 assert.deepEqual(payloads.map(p=>p.options.num_predict),[2048,4096,2048,4096]);assert.ok(progress.some(p=>p.includes('Reintentando')));assert.equal(s.busy,false);
});
test('invalid captions are retried, repeated truncation stops after one retry',async()=>{
 let n=0;const s=new CopyService({request:async p=>p.format?(++n===1?'bad JSON':JSON.stringify({captions:options(3)})):'Coffee.'});
 assert.deepEqual(await s.generate([{id:'a',base64:'photo'}]),options(3));assert.equal(n,2);
 n=0;s.request=async()=>{n++;const e=Error('cut');e.code='OLLAMA_TRUNCATED';throw e;};s.scenes.clear();
 await assert.rejects(s.generate([{id:'a',base64:'photo'}]),/después del reintento/);assert.equal(n,2);assert.equal(s.busy,false);
});
test('good and bad ratings persist across sessions, batches and toggles',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-copy-rating-')),file=path.join(dir,'copy-feedback.json');
 try{
  let prefs=new CopyFeedback(file);prefs.rate('No rush, just here.',1);prefs.rate('Books stack in quiet order.',-1);
  prefs=new CopyFeedback(file);assert.equal(prefs.rating('NO RUSH JUST HERE'),1);assert.equal(prefs.negative('Books stack in quiet order.'),true);
  const prompts=[];const s=new CopyService({feedback:prefs,request:async p=>{prompts.push(p);return p.format?JSON.stringify({captions:options(7)}):'Coffee cup by bookshelves.';}});
  await s.generate([{id:'new carousel',base64:'pixels'}]);
  assert.match(prompts.at(-1).messages[1].content,/No rush, just here/);assert.match(prompts.at(-1).messages[1].content,/Books stack in quiet order/);
  prefs.rate('No rush, just here.',0);assert.equal(new CopyFeedback(file).rating('No rush, just here.'),0);
  assert.throws(()=>prefs.rate('x\ny',1),/Valoración/);assert.equal(new CopyFeedback(file).rating('Books stack in quiet order.'),-1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('valid backup recovers preference store after interrupted or corrupt write',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-copy-recover-')),file=path.join(dir,'copy-feedback.json');
 try{const f=new CopyFeedback(file);f.rate('One good moment.',1);f.rate('Poor descriptive line.',-1);fs.writeFileSync(file,'broken');
  const recovered=new CopyFeedback(file);assert.equal(recovered.rating('One good moment.'),1);
  recovered.rate('Another good one.',1);assert.equal(new CopyFeedback(file).rating('Another good one.'),1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('rejects visual narration and disliked captions before returning five options',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pb-copy-filter-')),file=path.join(dir,'copy-feedback.json');
 try{const feedback=new CopyFeedback(file);feedback.rate('Books stack in quiet order.',-1);let attempts=0;
  const s=new CopyService({feedback,request:async p=>p.format?JSON.stringify({captions:++attempts===1?['Books stack in quiet order.','Warmth settles in the air.','Fingers brush book spines.','No rush, just here.','A quiet corner, just right.']:options(9)}):'Warm indoor space with books and coffee.'});
  assert.deepEqual(await s.generate([{id:'a',base64:'img'}]),options(9));assert.equal(attempts,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
