"""Crea parche incremental offline a partir de dos árboles de código PhotoBatch.
Uso: python build/make_patch.py RUTA_CODIGO_ANTERIOR RUTA_CODIGO_NUEVO SALIDA.zip
"""
import sys, json, hashlib, zipfile
from pathlib import Path

def produce(previous, current, target):
    previous, current, target=Path(previous), Path(current), Path(target)
    a=json.loads((previous/'package.json').read_text(encoding='utf8'))['version']
    b=json.loads((current/'package.json').read_text(encoding='utf8'))['version']
    if tuple(map(int,b.split('.'))) <= tuple(map(int,a.split('.'))): raise ValueError('La nueva versión debe ser posterior')
    choices=[current/'package.json'] + list((current/'app').iterdir())
    old_package=json.loads((previous/'package.json').read_text(encoding='utf8'))
    new_package=json.loads((current/'package.json').read_text(encoding='utf8'))
    before={**old_package.get('dependencies',{}),**old_package.get('optionalDependencies',{})}
    after={**new_package.get('dependencies',{}),**new_package.get('optionalDependencies',{})}
    runtime=current/'dist'/f'PhotoBatch-{b}-Windows'/'resources'/'app'
    for dependency, directory in [('fflate','node_modules/fflate'),('exiftool-vendored.pl','vendor/exiftool')]:
        if before.get(dependency)!=after.get(dependency):
            source=runtime/directory
            if not source.is_dir(): raise ValueError('Falta la dependencia empaquetada: '+directory)
            choices.extend(p for p in source.rglob('*') if p.is_file())
    changes=[]
    for file in choices:
        if not file.is_file(): continue
        rel=file.relative_to(runtime if runtime in file.parents else current).as_posix()
        if rel!='package.json' and not (rel.startswith('app/') and file.suffix in {'.js','.css','.html','.png','.ico','.ps1'}) and not rel.startswith(('node_modules/fflate/','vendor/exiftool/')):continue
        if not all(part.replace('_','').replace('-','').replace('.','').isalnum() for part in Path(rel).parts):raise ValueError('Ruta no permitida: '+rel)
        old=previous/rel
        data=file.read_bytes()
        if rel=='package.json' or runtime in file.parents or not old.exists() or old.read_bytes()!=data:
            changes.append((rel,data))
    if not changes:raise ValueError('No hay cambios')
    manifest={'schema':1,'product':'PhotoBatch','from':a,'to':b,'files':[{'path':k,'sha256':hashlib.sha256(v).hexdigest()} for k,v in changes]}
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        z.writestr('manifest.json',json.dumps(manifest,indent=2))
        for name,data in changes:z.writestr('files/'+name,data)
    print(target, target.stat().st_size,'bytes')
if __name__=='__main__':
    if len(sys.argv)!=4:raise SystemExit(__doc__)
    produce(*sys.argv[1:])
