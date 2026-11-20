"""Install a private release under /opt/genealogy behind an existing host Nginx.

Run as root over SSH stdin: python3 - /opt/genealogy/.incoming/release.tar.gz SHA256
The archive contains repository.bundle, manifest.json, site/, case/, access.json,
and optionally editor.sqlite3 for first-time recovery. Existing edits are never replaced.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request

ROOT=Path('/opt/genealogy')
DOMAIN='family.maark.ru'
VHOST=Path('/etc/nginx/sites-available')/DOMAIN
ENABLED=Path('/etc/nginx/sites-enabled')/DOMAIN
MARKER='# genealogy managed vhost'

def run(args,**kwargs):
    result=subprocess.run(args,capture_output=True,text=True,timeout=180,**kwargs)
    if result.returncode:raise RuntimeError(args[0]+': '+result.stderr[-1800:]+result.stdout[-1000:])
    return result.stdout.strip()

def install():
    archive=Path(sys.argv[1]).resolve()
    assert archive.is_relative_to(ROOT/'.incoming')
    assert hashlib.sha256(archive.read_bytes()).hexdigest()==sys.argv[2]
    stage=ROOT/'.incoming'/(archive.stem+'-unpacked')
    stage.mkdir(mode=0o700)
    with tarfile.open(archive,'r:gz') as tar:
        for m in tar.getmembers():
            assert (stage/m.name).resolve().is_relative_to(stage) and (m.isfile() or m.isdir()),'Unsafe member'
        tar.extractall(stage)
    manifest=json.loads((stage/'manifest.json').read_text())
    release=manifest['release']
    assert release.replace('-','').isalnum()
    private=ROOT/'private';private.mkdir(mode=0o700,exist_ok=True);private.chmod(0o700)
    access=json.loads((stage/'access.json').read_text())
    assert access['username'].isalnum()
    access_path=private/'access.json'
    if access_path.exists():assert json.loads(access_path.read_text())==access,'Refusing password change'
    shutil.copy2(stage/'access.json',access_path);access_path.chmod(0o600)
    new_repo=not (ROOT/'.git').exists()
    if new_repo:
        run(['git','init','-b','main',str(ROOT)])
        run(['git','-C',str(ROOT),'remote','add','origin','https://github.com/MerlinRus/FamilyGenealogy.git'])
    else:
        assert not run(['git','-C',str(ROOT),'status','--porcelain','--untracked-files=no']),'Tracked server changes'
    run(['git','-C',str(ROOT),'fetch',str(stage/'repository.bundle'),'main'])
    run(['git','-C',str(ROOT),'checkout','-B','main','FETCH_HEAD'] if new_repo else ['git','-C',str(ROOT),'merge','--ff-only','FETCH_HEAD'])
    assert run(['git','-C',str(ROOT),'rev-parse','HEAD'])==manifest['commit']
    shutil.copytree(stage/'case',private/'case',dirs_exist_ok=True)
    database=private/'editor.sqlite3'
    if database.exists():
        with sqlite3.connect(database) as src,sqlite3.connect(private/f'editor-before-{release}.sqlite3') as dst:src.backup(dst)
    elif (stage/'editor.sqlite3').exists():
        shutil.copy2(stage/'editor.sqlite3',database);database.chmod(0o600)
    if (stage/'recovery.json').exists():shutil.copy2(stage/'recovery.json',private/'recovery.json')
    destination=ROOT/'site'/'releases'/release
    shutil.copytree(stage/'site',destination)
    for path in destination.rglob('*'):path.chmod(0o750 if path.is_dir() else 0o640)
    destination.chmod(0o750)
    current=ROOT/'site'/'current'
    previous=os.readlink(current) if current.is_symlink() else None
    link=ROOT/'site'/('next-'+release);link.symlink_to(Path('releases')/release);os.replace(link,current)
    compose=['docker','compose','--project-directory',str(ROOT),'-f',str(ROOT/'deploy/compose.genealogy.yaml')]
    hashed=run(['docker','run','--rm','-i','caddy:2-alpine','caddy','hash-password'],input=access['password']+'\n')
    assert hashed.startswith('$2')
    config='''{
    admin off
    auto_https off
}
:8080 {
    basic_auth {
        USER HASH
    }
    header {
        Cache-Control "no-store"
        X-Content-Type-Options nosniff
        X-Robots-Tag "noindex, nofollow, noarchive"
        Referrer-Policy no-referrer
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        -Server
    }
    @editor path /api/* /data/family.json
    handle @editor {
        uri replace /data/family.json /api/data
        reverse_proxy api:8095
    }
    handle {
        root * /srv/current
        encode zstd gzip
        @notRead not method GET HEAD
        respond @notRead "Method not allowed" 405
        file_server
    }
}
'''.replace('USER HASH',access['username']+' '+hashed)
    (private/'Caddyfile').write_text(config);(private/'Caddyfile').chmod(0o600)
    run(compose+['config','--quiet'])
    run(compose+['up','-d','--wait','--wait-timeout','120'])
    # Verify auth before attaching the public hostname.
    try:urllib.request.urlopen('http://127.0.0.1:8094/data/family.json',timeout=5)
    except urllib.error.HTTPError as e:assert e.code==401
    else:raise RuntimeError('Authentication is missing')
    old=VHOST.read_text() if VHOST.exists() else None
    assert old is None or old.startswith(MARKER),'Unmanaged existing family vhost'
    assert not ENABLED.exists() or ENABLED.resolve()==VHOST,'Unexpected enabled vhost'
    if old is not None:(private/f'nginx-before-{release}.conf').write_text(old)
    acme=ROOT/'acme';acme.mkdir(mode=0o755,exist_ok=True)
    http=f'''{MARKER}
server {{
    listen 80;
    listen [::]:80;
    server_name {DOMAIN};
    location /.well-known/acme-challenge/ {{ root {acme}; }}
    location / {{ return 308 https://{DOMAIN}$request_uri; }}
}}
'''
    try:
        VHOST.write_text(http)
        if not ENABLED.exists():ENABLED.symlink_to(VHOST)
        run(['nginx','-t']);run(['systemctl','reload','nginx'])
        run(['certbot','certonly','--webroot','-w',str(acme),'-d',DOMAIN,'--cert-name',DOMAIN,'--non-interactive','--keep-until-expiring'])
        tls=f'''
server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name {DOMAIN};
    ssl_certificate /etc/letsencrypt/live/{DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 256k;
    location / {{
        proxy_pass http://127.0.0.1:8094;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }}
}}
'''
        VHOST.write_text(http+tls)
        run(['nginx','-t']);run(['systemctl','reload','nginx'])
    except Exception:
        if old is None:
            ENABLED.unlink(missing_ok=True);VHOST.unlink(missing_ok=True)
        else:VHOST.write_text(old)
        run(['nginx','-t']);run(['systemctl','reload','nginx'])
        raise
    hooks=Path('/etc/letsencrypt/renewal-hooks/deploy');hooks.mkdir(parents=True,exist_ok=True)
    hook=hooks/'genealogy-nginx'
    hook.write_text('#!/bin/sh\ncase " $RENEWED_DOMAINS " in *" family.maark.ru "*) nginx -t && systemctl reload nginx ;; esac\n');hook.chmod(0o755)
    result={**manifest,'previous_release':previous,'root':str(ROOT),'api':'Docker internal network only','web':'127.0.0.1:8094','tls':True}
    (private/'last-deployment.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))

if __name__=='__main__':install()
