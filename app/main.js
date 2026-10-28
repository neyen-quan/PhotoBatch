'use strict';
const {app,BrowserWindow,ipcMain,dialog,shell,nativeImage,protocol,net,session,clipboard}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const {BatchService}=require('./service'),{readMetadata}=require('./metadata'),{startUpdate}=require('./updater');
const {CopyService}=require('./copy');
const {CopyFeedback}=require('./copy-feedback');
const channel=require('./update-channel');
const {VideoService}=require('./video');
let copyService;

app.setName('PhotoBatch');app.commandLine.appendSwitch('lang','es-AR');
app.setPath('userData',process.env.PHOTOBATCH_TEST_ROOT?path.join(process.env.PHOTOBATCH_TEST_ROOT,'userdata'):path.join(app.getPath('appData'),'PhotoBatch'));
protocol.registerSchemesAsPrivileged([{scheme:'photobatch',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win,service,videoService,tempRoot;
if(!process.env.PHOTOBATCH_TEST_ROOT&&!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
function thumbnail(image){const s=image.getSize(),scale=Math.min(1,480/s.width,360/s.height);return image.resize({width:Math.max(1,Math.round(s.width*scale)),height:Math.max(1,Math.round(s.height*scale)),quality:'good'}).toDataURL();}
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{if(!event.senderFrame||!event.senderFrame.url.startsWith('photobatch://app/'))return {ok:false,error:'Origen no autorizado.'};try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,error:e.message};}});}
async function importPath(file,name){const source=await service.importFile(file,name),image=nativeImage.createFromPath(file);if(image.isEmpty()&&source.format!=='webp'){service.forget([source.id]);throw Error('No se pudo mostrar la imagen.');}source.preview=image.isEmpty()?'data:image/webp;base64,'+fs.readFileSync(file).toString('base64'):thumbnail(image);return source;}
app.whenReady().then(async()=>{
 let copyFeedbackError=null,feedback=null;
 try{feedback=new CopyFeedback(path.join(app.getPath('userData'),'copy-feedback.json'));}catch(e){copyFeedbackError=e.message;}
 copyService=new CopyService({feedback});
 protocol.handle('photobatch',request=>{const u=new URL(request.url),name=u.pathname.slice(1);if(u.host!=='app'||!['index.html','style.css','renderer.js'].includes(name))return new Response('Not found',{status:404});return net.fetch(pathToFileURL(path.join(__dirname,name)).href);});
 session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_d,cb)=>cb({cancel:true}));
 tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'PhotoBatch-'));let startupError=null;
 try{service=new BatchService({stateDir:path.join(app.getPath('userData'),'history'),tempDir:tempRoot,downloads:process.env.PHOTOBATCH_TEST_ROOT?path.join(process.env.PHOTOBATCH_TEST_ROOT,'Downloads'):app.getPath('downloads'),onProgress:p=>win?.webContents.send('progress',p)});service.history.summary();}catch(e){startupError=e.message;}
 videoService=new VideoService(process.env.PHOTOBATCH_TEST_ROOT?path.join(process.env.PHOTOBATCH_TEST_ROOT,'Downloads'):app.getPath('downloads'));
 handle('init',()=>({version:app.getVersion(),error:startupError,copyError:copyFeedbackError,history:startupError?null:service.history.summary()}));
 handle('pick',async()=>{const r=await dialog.showOpenDialog(win,{title:'Agregar imágenes originales',properties:['openFile','multiSelections'],filters:[{name:'Imágenes',extensions:['png','jpg','jpeg','webp']}]});return r.canceled?[]:r.filePaths.slice(0,10);});
 async function videoThumb(file){if(process.platform!=='win32')return null;const image=await nativeImage.createThumbnailFromPath(file,{width:480,height:360});return image.isEmpty()?null:image.resize({width:280,quality:'good'}).toDataURL();}
 handle('pickVideos',async()=>{const r=await dialog.showOpenDialog(win,{title:'Elegir videos originales',properties:['openFile','multiSelections'],filters:[{name:'Videos',extensions:['mp4','mov','m4v']}]});return r.canceled?null:videoService.add(r.filePaths,videoThumb);});
 handle('addVideos',paths=>videoService.add(paths,videoThumb));
 handle('forgetVideos',ids=>videoService.forget(ids));
 handle('cleanVideos',(ids,name)=>videoService.clean(ids,name,p=>win?.webContents.send('videoProgress',p)));
 handle('import',file=>{if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Seleccioná un archivo local.');return importPath(file);});
 handle('importBytes',async payload=>{if(!payload||(!ArrayBuffer.isView(payload.bytes)&&!(payload.bytes instanceof ArrayBuffer)))throw Error('No se recibió un archivo de imagen.');const b=Buffer.from(payload.bytes);if(b.length>100*1024*1024)throw Error('La imagen supera los 100 MiB.');const name=path.basename(String(payload.name||'imagen.png')),ext=path.extname(name).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(ext))throw Error('Formato no compatible.');const f=path.join(tempRoot,crypto.randomUUID()+ext);fs.writeFileSync(f,b,{flag:'wx'});try{return await importPath(f,name);}catch(e){try{fs.unlinkSync(f);}catch{}throw e;}});
 handle('forget',ids=>{copyService.forget(ids);return service.forget(ids);});handle('preview',(c,items)=>service.preview(c,items));handle('export',(token,name)=>service.export(token,name));handle('history',()=>service.history.summary());
 handle('update',async()=>{if(service.busy||copyService.busy||videoService.busy)throw Error('Esperá a que termine la operación.');const r=await dialog.showOpenDialog(win,{title:'Seleccionar parche local de PhotoBatch',defaultPath:app.getPath('downloads'),properties:['openFile'],filters:[{name:'Parche PhotoBatch',extensions:['zip']}]});if(r.canceled)return {canceled:true};const detail=await startUpdate({patchPath:r.filePaths[0],appRoot:path.resolve(__dirname,'..'),version:app.getVersion(),userData:app.getPath('userData'),exe:process.execPath,showConfirmation:async summary=>(await dialog.showMessageBox(win,{type:'question',buttons:['Cancelar','Instalar y reiniciar'],defaultId:0,cancelId:0,title:'Confirmar parche',message:`Actualizar PhotoBatch ${summary.from} → ${summary.to}`,detail:`${summary.files} archivos modificados. Se realizará un respaldo local antes de instalar. El programa se cerrará durante la actualización.`})).response===1});if(detail?.started)setImmediate(()=>app.quit());return detail;});
 handle('getUpdateChannel',()=>channel.getChannel(app.getPath('userData')));
 handle('setUpdateChannel',url=>channel.setChannel(app.getPath('userData'),url));
 handle('checkUpdate',()=>channel.check(app.getPath('userData'),app.getVersion()));
 handle('installOnlineUpdate',async()=>{if(service.busy||copyService.busy||videoService.busy)throw Error('Esperá a que termine la operación.');const info=await channel.check(app.getPath('userData'),app.getVersion());if(!info.patch)throw Error('No hay un parche compatible para esta versión.');const file=await channel.downloadPatch(info,app.getPath('userData'));try{const detail=await startUpdate({patchPath:file,appRoot:path.resolve(__dirname,'..'),version:app.getVersion(),userData:app.getPath('userData'),exe:process.execPath,showConfirmation:async summary=>(await dialog.showMessageBox(win,{type:'question',buttons:['Cancelar','Instalar y reiniciar'],defaultId:0,cancelId:0,title:'Confirmar actualización',message:`PhotoBatch ${summary.from} → ${summary.to}`,detail:`Parche de GitHub verificado (${summary.files} archivos). Se guardará un respaldo antes de instalar.`})).response===1});if(detail?.started)setImmediate(()=>app.quit());return detail;}finally{fs.rmSync(file,{force:true});}});
 handle('createCopy',async entries=>{
  const ids=Array.isArray(entries)?entries.map(x=>x?.id):null;
  if(copyService.busy)throw Error('Ya se está creando un copy.');
  if(!Array.isArray(ids)||!ids.length||ids.length>10||new Set(ids).size!==ids.length)throw Error('Cargá entre 1 y 10 fotos.');
  const images=ids.map(id=>{const source=service.sources.get(id);if(!source)throw Error('Volvé a cargar las fotos.');
   if(copyService.scenes.has(id))return {id};
   let image=nativeImage.createFromPath(source.path);
   const fallback=entries.find(x=>x.id===id)?.preview;
   if(image.isEmpty()&&source.format==='webp'&&typeof fallback==='string'&&fallback.startsWith('data:image/png;base64,')&&fallback.length<2*1024*1024)image=nativeImage.createFromDataURL(fallback);
   if(image.isEmpty())throw Error('No se pudo leer una foto para la IA. Probá con PNG o JPG.');
   const size=image.getSize(),scale=Math.min(1,1024/size.width,1024/size.height);
   return {id,base64:image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale)),quality:'good'}).toJPEG(85).toString('base64')};
  });
  return copyService.generate(images,message=>win?.webContents.send('copyProgress',message));
 });
 handle('copyCaption',text=>{if(typeof text!=='string'||!text.trim()||text.length>180)throw Error('Texto no válido.');clipboard.writeText(text);return true;});
 handle('rateCopy',(text,rating)=>{if(!feedback)throw Error(copyFeedbackError);return feedback.rate(text,rating);});
 handle('copyRating',text=>feedback?.rating(text)||0);
 handle('metadata',id=>{const s=service.sources.get(id);if(!s)throw Error('Imagen no disponible.');return readMetadata(s.path);});
 handle('openDownloads',()=>shell.openPath(service.downloads));handle('backup',()=>service.backup());
 handle('restore',async()=>{if(service.busy)throw Error('Esperá a que termine la exportación.');const r=await dialog.showOpenDialog(win,{title:'Restaurar historial',properties:['openFile'],filters:[{name:'Respaldo PhotoBatch',extensions:['json']}]});if(r.canceled)return null;const f=r.filePaths[0];if(fs.statSync(f).size>50*1024*1024)throw Error('Respaldo demasiado grande.');const count=service.history.restore(fs.readFileSync(f,'utf8'));service.plan=null;return {count,history:service.history.summary()};});
 win=new BrowserWindow({width:1380,height:960,minWidth:1020,minHeight:740,title:'PhotoBatch',icon:path.join(__dirname,'icon.png'),backgroundColor:'#0b1010',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 win.removeMenu();win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.on('close',e=>{if(service?.busy||videoService?.busy){e.preventDefault();dialog.showMessageBox(win,{type:'info',message:'Esperá a que termine la exportación.',detail:'Estamos verificando las imágenes y guardando el ZIP.'});}});
 await win.loadURL('photobatch://app/index.html');
});
app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>{if(tempRoot)try{fs.rmSync(tempRoot,{recursive:true,force:true});}catch{}});
