"""Upload a checked build and Git bundle using the owner's existing local SSH key."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import secrets
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parents[1]

def run(args,**kwargs):
    subprocess.run(args,check=True,**kwargs)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--identity',type=Path,required=True)
    ap.add_argument('--host',default='root@45.85.93.156')
    ap.add_argument('--port',default='9022')
    ap.add_argument('--case',type=Path,default=ROOT.parent/'Genealogy')
    args=ap.parse_args()
    run(['node','--test','tests/model.test.js','tests/presentation.test.js'],cwd=ROOT)
    run(['node','--check','web/app.js'],cwd=ROOT)
    run(['python',str(ROOT/'scripts'/'build.py'),'--case',str(args.case)],cwd=ROOT)
    private=ROOT/'.private';private.mkdir(exist_ok=True)
    access_file=private/'access.json'
    if not access_file.exists():
        access_file.write_text(json.dumps({'username':'family','password':secrets.token_urlsafe(24)}),encoding='utf-8')
    access=json.loads(access_file.read_text(encoding='utf-8'))
    credentials=args.case/'site-access.txt'
    credentials.write_text(f"Семейный атлас\nhttps://family.maark.ru\nЛогин: {access['username']}\nПароль: {access['password']}\n\nХранить отдельно от репозитория и семейных источников.\n",encoding='utf-8')
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    release=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+commit[:8]
    bundle=private/'repository.bundle'
    run(['git','bundle','create',str(bundle),'--all'],cwd=ROOT)
    manifest=private/'manifest.json';manifest.write_text(json.dumps({'commit':commit,'release':release}),encoding='utf-8')
    package=private/(release+'.tar.gz')
    with tarfile.open(package,'w:gz') as tar:
        tar.add(bundle,arcname='repository.bundle')
        tar.add(manifest,arcname='manifest.json')
        tar.add(access_file,arcname='access.json')
        for path in (ROOT/'dist').rglob('*'):
            if path.is_file() and not path.name.startswith('__'):tar.add(path,arcname='site/'+path.relative_to(ROOT/'dist').as_posix())
        for path in args.case.rglob('*'):
            if not path.is_file() or path.name.startswith('site-') or path.name.startswith('.'):continue
            if path.suffix.lower() in {'.md','.txt','.json','.pdf','.png','.jpg','.jpeg','.doc','.zip'}:
                tar.add(path,arcname='case/'+path.relative_to(args.case).as_posix())
    digest=hashlib.sha256(package.read_bytes()).hexdigest()
    ssh=['ssh','-i',str(args.identity),'-p',args.port,'-o','IdentitiesOnly=yes','-o','BatchMode=yes',args.host]
    run(ssh+['install -d -m 700 /opt/familytree/.incoming'])
    print(f'Uploading private release ({package.stat().st_size//1048576} MB)',flush=True)
    remote_archive='/opt/familytree/.incoming/'+package.name
    run(['scp','-i',str(args.identity),'-P',args.port,'-o','IdentitiesOnly=yes','-o','BatchMode=yes',str(package),args.host+':'+remote_archive])
    print('Installing and validating Caddy',flush=True)
    installer=(ROOT/'deploy'/'remote_install.py').read_text(encoding='utf-8')
    subprocess.run(ssh+['python3 - '+remote_archive+' '+digest],input=installer,text=True,check=True)
    print('Credentials saved to '+str(credentials),flush=True)

if __name__=='__main__':main()
