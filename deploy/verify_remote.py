"""Verify public TLS and authentication without printing credentials or family facts."""
import base64
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import urllib.error
import urllib.request

ROOT=Path('/opt/familytree')
BASE='https://family.maark.ru'

def request(path,credentials=None):
    headers={}
    if credentials:
        token=base64.b64encode((credentials['username']+':'+credentials['password']).encode()).decode()
        headers['Authorization']='Basic '+token
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE+path,headers=headers),timeout=20) as response:
            return response.status,response.read(),dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code,error.read(),dict(error.headers)

def main():
    access=json.loads((ROOT/'private'/'access.json').read_text())
    checks={}
    for path in ['/','/data/family.json','/sources/S016-maternal-family-account.txt','/healthz']:
        code,body,headers=request(path)
        assert code==401,(path,code)
        assert headers.get('Cache-Control')=='no-store'
        checks[path]='unauthenticated:401'
    code,body,_=request('/',access)
    assert code==200 and b'type="module"' in body
    code,body,headers=request('/data/family.json',access)
    assert code==200
    data=json.loads(body)
    assert len(data['people'])==26 and len(data['sources'])==24 and len(data['candidate_links'])==6
    sample=next(a for a in data['artifacts'] if a['name']=='S020-Yakov-POW-frame4.png')
    code,image,_=request(sample['url'],access)
    assert code==200 and hashlib.sha256(image).hexdigest()==sample['sha256']
    bad=dict(access);bad['password']='deliberately-wrong-verification-password'
    assert request('/data/family.json',bad)[0]==401
    assert 'frame-ancestors' in headers.get('Content-Security-Policy','')
    result={'tls':'verified with system trust','without_password':checks,'wrong_password':401,'authenticated_html':200,'authenticated_data':200,'source_sha256':'matches','people':26,'sources':24,'candidates':6,'source_files':len(data['artifacts']),'verified_at':datetime.now(timezone.utc).isoformat()}
    (ROOT/'private'/'verification.json').write_text(json.dumps(result,indent=2))
    deployment=ROOT/'private'/'last-deployment.json'
    if deployment.exists():
        record=json.loads(deployment.read_text());record['auth_verified']=True;record['verification']=result;deployment.write_text(json.dumps(record,indent=2))
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
