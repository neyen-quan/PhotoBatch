// Optional UI harness: NODE_PATH=/path/to/jsdom/node_modules node tests/copy-ui.cjs
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'app/index.html'),'utf8');
const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://photobatch.test/'}),w=dom.window;
let round=0,copied='',calls=[],pending,fail=false,ratings=new Map();
w.photoBatch={init:async()=>({version:'1.2.9',history:{last:null}}),onProgress:()=>{},onCopyProgress:()=>{},onVideoProgress:()=>{},forget:async()=>{},forgetVideos:async()=>{},pickVideos:async()=>({accepted:[{id:'v1',name:'clip.mp4',size:1000000}],skipped:0,sequence:[384721,417093]}),cleanVideos:async()=>({zipName:'reels.zip',items:[{name:'clip_384721.mp4',originalName:'clip.mp4',removed:3}],sequence:[562804,617801]}),
 createCopy:async images=>{calls.push(images);if(fail)throw Error('Abrí Ollama');if(pending)return pending;return Array.from({length:5},(_,i)=>`Caption ${++round} option ${i}.`);},copyCaption:async s=>{copied=s;},copyRating:async s=>ratings.get(s)||0,rateCopy:async(s,r)=>{ratings.set(s,r);return r;}};
w.assert=assert;w.check=()=>({copied,calls});w.setFailure=v=>fail=v;w.waitForCopy=()=>{let resolve;pending=new Promise(r=>resolve=r);return resolve;};
const harness=`
window.testDone=(async()=>{
 await new Promise(r=>setTimeout(r,0));assert.equal($('copyButton').disabled,true);
 slots[0]={id:'a',name:'a.png',format:'png',preview:'',width:100,height:100,camera:'back'};
 slots[1]={id:'b',name:'b.webp',format:'webp',preview:'data:image/png;base64,eA==',width:100,height:100,camera:'front'};render();
 assert.equal($('copyButton').disabled,false);await $('copyButton').onclick();
 assert.equal(document.querySelectorAll('.copy-option').length,5);assert.equal(check().calls[0].length,2);
 assert.equal(check().calls[0][1].preview,'data:image/png;base64,eA==');
 const first=$('copyOptions').textContent;const good=document.querySelector('.copy-option .copy-rate'),bad=document.querySelectorAll('.copy-option .copy-rate')[1];await good.onclick();assert.equal(good.getAttribute('aria-pressed'),'true');await bad.onclick();assert.equal(good.getAttribute('aria-pressed'),'false');assert.equal(bad.getAttribute('aria-pressed'),'true');await bad.onclick();assert.equal(bad.getAttribute('aria-pressed'),'false');await document.querySelector('.copy-option .secondary').onclick();assert.equal(check().copied,'Caption 1 option 0.');
 assert.match($('copyButton').textContent,/otras 5/);await $('copyButton').onclick();assert.notEqual($('copyOptions').textContent,first);
 setFailure(true);await $('copyButton').onclick();assert.match($('copyStatus').textContent,/Abrí Ollama/);assert.equal(document.querySelectorAll('.copy-option').length,5);setFailure(false);
 const finish=waitForCopy(),running=$('copyButton').onclick();assert.equal($('copyButton').disabled,true);assert.equal($('updateButton').disabled,true);
 slots[1]=null;render();assert.equal(document.querySelectorAll('.copy-option').length,0);finish(['one','two','three','four','five']);await running;
 assert.equal(document.querySelectorAll('.copy-option').length,0);assert.match($('copyStatus').textContent,/Cambiaste/);
 await $('clearButton').onclick();assert.equal($('copyButton').disabled,true);
 $('videoMode').click();assert.equal($('videoView').hidden,false);assert.equal($('photoView').hidden,true);await $('videoPick').onclick();assert.equal($('videoClean').disabled,false);assert.equal(document.querySelectorAll('#videoSlots .slot').length,10);assert.match($('videoSlots').textContent,/clip_384721.mp4/);await $('videoClean').onclick();assert.match($('videoResultName').textContent,/reels.zip/);assert.match($('videoSlots').textContent,/clip_562804.mp4/);$('photoMode').click();assert.equal($('videoView').hidden,true);assert.equal($('photoView').hidden,false);
})();`;
w.eval(fs.readFileSync(path.join(root,'app/renderer.js'),'utf8')+'\n'+harness);
w.testDone.then(()=>{console.log('UI PASS: five options, regenerate, clipboard, errors, busy state and changed photos.');dom.window.close();}).catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
