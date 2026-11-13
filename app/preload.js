'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
const invoke=(channel,...args)=>ipcRenderer.invoke(channel,...args).then(r=>{if(!r.ok)throw Error(r.error);return r.value;});
contextBridge.exposeInMainWorld('photoBatch',{
 init:()=>invoke('init'),pick:()=>invoke('pick'),importPath:p=>invoke('import',p),
 pickVideos:()=>invoke('pickVideos'),addVideoFiles:files=>invoke('addVideos',files.map(f=>webUtils.getPathForFile(f)).filter(Boolean)),forgetVideos:ids=>invoke('forgetVideos',ids),cleanVideos:(ids,name,config)=>invoke('cleanVideos',ids,name,config),onVideoProgress:callback=>{const f=(_e,p)=>callback(p);ipcRenderer.on('videoProgress',f);return ()=>ipcRenderer.removeListener('videoProgress',f);},
 importFile:file=>{const p=webUtils.getPathForFile(file);return p?invoke('import',p):file.arrayBuffer().then(bytes=>invoke('importBytes',{name:file.name,bytes:new Uint8Array(bytes)}));},
 forget:ids=>invoke('forget',ids),preview:(c,items)=>invoke('preview',c,items),export:(token,name,type)=>invoke('export',token,name,type),metadata:id=>invoke('metadata',id),history:()=>invoke('history'),openDownloads:()=>invoke('openDownloads'),backup:()=>invoke('backup'),restore:()=>invoke('restore'),update:()=>invoke('update'),getUpdateChannel:()=>invoke('getUpdateChannel'),setUpdateChannel:url=>invoke('setUpdateChannel',url),checkUpdate:()=>invoke('checkUpdate'),installOnlineUpdate:()=>invoke('installOnlineUpdate'),
 onProgress:callback=>{const f=(_e,p)=>callback(p);ipcRenderer.on('progress',f);return ()=>ipcRenderer.removeListener('progress',f);}
});
