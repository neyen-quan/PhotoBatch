from pathlib import Path
import zipfile,tarfile,shutil,json,subprocess,hashlib
root=Path(__file__).resolve().parents[1];out=root/'dist';out.mkdir(exist_ok=True)
version=json.loads((root/'package.json').read_text())['version']
folder=out/f'PhotoBatch-{version}-Windows';folder.mkdir(exist_ok=True)
with zipfile.ZipFile(next((root/'build/cache').rglob('electron-v44.9.0-win32-x64.zip'))) as z:z.extractall(folder)
(folder/'electron.exe').replace(folder/'PhotoBatch.exe')
(folder/'resources/default_app.asar').unlink(missing_ok=True)
app=folder/'resources/app';app.mkdir(exist_ok=True)
shutil.copytree(root/'app',app/'app',dirs_exist_ok=True)
package=json.loads((root/'package.json').read_text());package.pop('devDependencies',None);package['dependencies']={'fflate':'0.8.3'};(app/'package.json').write_text(json.dumps(package,indent=2))
shutil.copytree(root/'node_modules/fflate',app/'node_modules/fflate',dirs_exist_ok=True)
vendor=app/'vendor/exiftool';vendor.mkdir(parents=True,exist_ok=True)
with tarfile.open(root/'build/exiftool-vendored.exe-13.59.3.tgz') as tar:
 for member in tar.getmembers():
  member.name=str(Path(member.name).relative_to('package'))
  if member.name!='.':tar.extract(member,vendor,filter='data')
shutil.copy2(root/'README.md',folder/'README.md')
shutil.copy2(root/'LICENSE',folder/'LICENSE-PhotoBatch.txt')
subprocess.run(['node',str(root/'build/brand-exe.mjs'),str(folder/'PhotoBatch.exe'),str(root/'app/icon.ico')],check=True,cwd=root)
with zipfile.ZipFile(out/f'PhotoBatch-{version}-Windows.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(folder.rglob('*')):
  if p.is_file() and not any(part.startswith('.') for part in p.relative_to(folder).parts):z.write(p,p.relative_to(out))
with zipfile.ZipFile(out/f'PhotoBatch-{version}-Codigo.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 files=[p for p in (root/'app').rglob('*') if p.is_file()]
 files.extend(p for p in (root/'tests').rglob('*') if p.is_file() and (p.suffix in ['.js','.cjs','.py','.sh'] or 'fixtures' in p.parts))
 for name in ['package.json','package-lock.json','README.md','LICENSE','build/brand-exe.mjs','build/package.py','build/download.mjs','build/make_patch.py']:files.append(root/name)
 for p in files:z.write(p,Path('PhotoBatch-Codigo')/p.relative_to(root))
for p in sorted(out.glob('*.zip')):
 with zipfile.ZipFile(p) as z:assert z.testzip() is None
 print(p.name,p.stat().st_size,'bytes',hashlib.sha256(p.read_bytes()).hexdigest())
