import fs from 'node:fs';import * as PE from 'pe-library';import * as R from 'resedit';
const file=process.argv[2],exe=PE.NtExecutable.from(fs.readFileSync(file),{ignoreCert:true}),res=PE.NtExecutableResource.from(exe),icon=R.Data.IconFile.from(fs.readFileSync(process.argv[3]));
for(const group of R.Resource.IconGroupEntry.fromEntries(res.entries))R.Resource.IconGroupEntry.replaceIconsForResource(res.entries,group.id,group.lang,icon.icons.map(x=>x.data));
for(const vi of R.Resource.VersionInfo.fromEntries(res.entries)){
 vi.setFileVersion(1,0,0,0,1033);vi.setProductVersion(1,0,0,0,1033);
 for(const locale of vi.getAvailableLanguages())vi.setStringValues(locale,{FileDescription:'PhotoBatch',ProductName:'PhotoBatch',CompanyName:'PhotoBatch',InternalName:'PhotoBatch',OriginalFilename:'PhotoBatch.exe',LegalCopyright:'PhotoBatch 2026',FileVersion:'1.0.0',ProductVersion:'1.0.0'});
 vi.outputToResourceEntries(res.entries);
}
res.outputResource(exe);fs.writeFileSync(file,Buffer.from(exe.generate()));
const check=PE.NtExecutableResource.from(PE.NtExecutable.from(fs.readFileSync(file)));if(!R.Resource.IconGroupEntry.fromEntries(check.entries).length)throw Error('Missing icon');console.log('PhotoBatch.exe: PE resources verified');
