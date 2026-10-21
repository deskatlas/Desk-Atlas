import ast
import json
from pathlib import Path
import shutil
import sys
root=Path(sys.argv[1])
mode=sys.argv[2]
patches=json.loads(Path(__file__).with_name('patches.json').read_text())
prepared=[]
for name,changes in patches.items():
    if mode=='api' and name.startswith('knowledge/'):
        continue
    path=root/name
    original=path.read_text()
    updated=original
    for old,new in changes:
        if updated.count(old)!=1:
            raise SystemExit('PATCH_BASE_MISMATCH: '+name)
        updated=updated.replace(old,new,1)
    ast.parse(updated)
    prepared.append((path,updated))
for path,updated in prepared:
    if mode=='worker':
        backup=path.with_name(path.name+'.before-upload-repair-20261021')
        if backup.exists():
            raise SystemExit('BACKUP_ALREADY_EXISTS')
        shutil.copy2(path,backup)
    path.write_text(updated)
print('UPLOAD_REPAIR_APPLIED: '+mode)
