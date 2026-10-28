'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
const invoke=(channel,...args)=>ipcRenderer.invoke(channel,...args).then(r=>{if(!r.ok)throw Error(r.error);return r.value;});
contextBridge.exposeInMainWorld('photoBatch',{
 createCopy:ids=>invoke('createCopy',ids),copyCaption:text=>invoke('copyCaption',text),rateCopy:(text,rating)=>invoke('rateCopy',text,rating),copyRating:text=>invoke('copyRating',text),
 onCopyProgress:callback=>{const f=(_e,p)=>callback(p);ipcRenderer.on('copyProgress',f);return ()=>ipcRenderer.removeListener('copyProgress',f);},
 init:()=>invoke('init'),pick:()=>invoke('pick'),importPath:p=>invoke('import',p),
 pickVideos:()=>invoke('pickVideos'),addVideoFiles:files=>invoke('addVideos',files.map(f=>webUtils.getPathForFile(f)).filter(Boolean)),forgetVideos:ids=>invoke('forgetVideos',ids),cleanVideos:(ids,name)=>invoke('cleanVideos',ids,name),onVideoProgress:callback=>{const f=(_e,p)=>callback(p);ipcRenderer.on('videoProgress',f);return ()=>ipcRenderer.removeListener('videoProgress',f);},
 importFile:file=>{const p=webUtils.getPathForFile(file);return p?invoke('import',p):file.arrayBuffer().then(bytes=>invoke('importBytes',{name:file.name,bytes:new Uint8Array(bytes)}));},
 forget:ids=>invoke('forget',ids),preview:(c,items)=>invoke('preview',c,items),export:(token,name)=>invoke('export',token,name),metadata:id=>invoke('metadata',id),history:()=>invoke('history'),openDownloads:()=>invoke('openDownloads'),backup:()=>invoke('backup'),restore:()=>invoke('restore'),update:()=>invoke('update'),
 onProgress:callback=>{const f=(_e,p)=>callback(p);ipcRenderer.on('progress',f);return ()=>ipcRenderer.removeListener('progress',f);}
});
