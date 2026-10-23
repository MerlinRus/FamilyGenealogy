"""Run over SSH stdin. All changes are scoped to familytree and its Caddy vhost."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

ROOT = Path('/opt/familytree')
DOMAIN = 'family.maark.ru'
EDGE_CONFIG = Path('/opt/after-rain/Caddyfile')
EDGE_CONTAINER = 'after-rain-web'
MARKER_START = '# familytree managed start'
MARKER_END = '# familytree managed end'

def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=90, **kwargs)
    if result.returncode:
        raise RuntimeError(f'Command failed: {args[0]}: {result.stderr[-1500:]}')
    return result.stdout.strip()

def status(domain, path='/healthz'):
    p = subprocess.run(['curl','--connect-timeout','3','--max-time','8','--resolve',f'{domain}:443:127.0.0.1','-s','-o','/dev/null','-w','%{http_code}',f'https://{domain}{path}'],capture_output=True,text=True,timeout=12)
    return p.stdout.strip()

def main():
    archive = Path(sys.argv[1]).resolve()
    expected_hash = sys.argv[2]
    assert archive.is_relative_to(ROOT / '.incoming')
    (ROOT/'.incoming').chmod(0o700)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected_hash, 'Upload checksum mismatch'
    release = archive.name.removesuffix('.tar.gz')
    stage = ROOT / '.incoming' / (release + '-unpacked')
    stage.mkdir(parents=True, mode=0o700, exist_ok=False)
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar.getmembers():
            target = (stage / member.name).resolve()
            if not target.is_relative_to(stage) or member.issym() or member.islnk():
                raise ValueError('Unsafe archive member')
        tar.extractall(stage)
    manifest = json.loads((stage/'manifest.json').read_text())
    private = ROOT/'private'
    private.mkdir(mode=0o700, exist_ok=True)
    os.chmod(private,0o700)
    access = json.loads((stage/'access.json').read_text())
    access_file = private/'access.json'
    if access_file.exists() and json.loads(access_file.read_text()) != access:
        raise RuntimeError('Existing password differs; refusing an implicit password change')
    access_file.write_text(json.dumps(access))
    os.chmod(access_file,0o600)
    bundle = stage/'repository.bundle'
    if not (ROOT/'.git').exists():
        run(['git','init','-b','main',str(ROOT)])
        run(['git','-C',str(ROOT),'fetch',str(bundle),'main'])
        run(['git','-C',str(ROOT),'checkout','-B','main','FETCH_HEAD'])
        run(['git','-C',str(ROOT),'remote','add','origin','https://github.com/MerlinRus/FamilyGenealogy.git'])
    else:
        if run(['git','-C',str(ROOT),'status','--porcelain','--untracked-files=no']):
            raise RuntimeError('Server has tracked local changes; refusing overwrite')
        run(['git','-C',str(ROOT),'fetch',str(bundle),'main'])
        run(['git','-C',str(ROOT),'merge','--ff-only','FETCH_HEAD'])
    assert run(['git','-C',str(ROOT),'rev-parse','HEAD']) == manifest['commit']
    shutil.copytree(stage/'case',private/'case',dirs_exist_ok=True)
    releases = ROOT/'site'/'releases'
    releases.mkdir(parents=True,exist_ok=True)
    destination = releases/release
    shutil.copytree(stage/'site',destination)
    for path in destination.rglob('*'):
        path.chmod(0o750 if path.is_dir() else 0o640)
    destination.chmod(0o750)
    current = ROOT/'site'/'current'
    previous = os.readlink(current) if current.is_symlink() else None
    temporary_link = ROOT/'site'/('current-'+release)
    temporary_link.symlink_to(Path('releases')/release)
    os.replace(temporary_link,current)
    before = {domain:status(domain) for domain in ['city.maark.ru','polka.maark.ru']}
    old_config = EDGE_CONFIG.read_text()
    backup = private/f'Caddyfile.before-{release}'
    backup.write_text(old_config)
    os.chmod(backup,0o600)
    changed = False
    try:
        run(['docker','compose','-p','familytree','up','-d'],cwd=ROOT)
        healthy = False
        for _ in range(8):
            try:
                healthy = urllib.request.urlopen('http://127.0.0.1:8094/healthz',timeout=3).read().strip()==b'ok'
            except OSError:
                pass
            if healthy: break
            time.sleep(1)
        assert healthy,'Internal site health check failed'
        hashed = run(['docker','exec','-i',EDGE_CONTAINER,'caddy','hash-password'],input=access['password']+'\n')
        assert hashed.startswith('$2'), 'Unexpected password hash'
        block = f'''{MARKER_START}
{DOMAIN} {{
    basic_auth {{
        {access['username']} {hashed}
    }}
    header {{
        Cache-Control "no-store"
        X-Content-Type-Options nosniff
        X-Robots-Tag "noindex, nofollow, noarchive"
        Referrer-Policy no-referrer
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        Strict-Transport-Security "max-age=31536000"
        -Server
    }}
    reverse_proxy 127.0.0.1:8094
}}
{MARKER_END}
'''
        if MARKER_START in old_config:
            new_config = re.sub(re.escape(MARKER_START)+r'.*?'+re.escape(MARKER_END),lambda _:block.strip(),old_config,flags=re.S)
        else:
            if re.search(r'(?m)^\s*family\.maark\.ru\s*\{',old_config):
                raise RuntimeError('An unmanaged family domain config already exists')
            new_config=old_config.rstrip()+'\n\n'+block
        EDGE_CONFIG.write_text(new_config)
        changed = True
        run(['docker','exec',EDGE_CONTAINER,'caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'])
        run(['docker','exec',EDGE_CONTAINER,'caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'])
        after={domain:status(domain) for domain in before}
        for domain,code in before.items():
            if code=='200' and after[domain]!='200': raise RuntimeError(f'Existing site health changed: {domain}')
        result={'release':release,'commit':manifest['commit'],'internal_health':'ok','previous_release':previous,'other_sites':after,'auth_verified':False}
        try: result['dns_addresses']=sorted({a[4][0] for a in socket.getaddrinfo(DOMAIN,443)})
        except socket.gaierror: result['dns_addresses']=[]
        (private/'last-deployment.json').write_text(json.dumps(result,indent=2))
        print('DEPLOYMENT '+json.dumps(result),flush=True)
    except Exception:
        if changed:
            EDGE_CONFIG.write_text(old_config)
            run(['docker','exec',EDGE_CONTAINER,'caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'])
        if previous:
            recovery=ROOT/'site'/('recover-'+release)
            recovery.symlink_to(previous)
            os.replace(recovery,current)
        raise

if __name__=='__main__': main()
