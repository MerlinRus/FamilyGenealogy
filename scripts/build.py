"""Build the static site; private case data lives only in the ignored output."""
import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def build(case_dir, out):
    case_dir, out = case_dir.resolve(), out.resolve()
    data = json.loads((case_dir / 'evidence.json').read_text(encoding='utf-8'))
    if len({p['id'] for p in data['people']}) != len(data['people']):
        raise ValueError('Duplicate person ID')
    out.mkdir(parents=True, exist_ok=True)
    for src in (ROOT / 'web').iterdir():
        if src.is_file(): shutil.copy2(src, out / src.name)
    docs = out / 'sources'
    docs.mkdir(exist_ok=True)
    artifacts = []
    allowed = {'.png', '.jpg', '.jpeg', '.webp', '.pdf', '.md', '.txt', '.json', '.doc', '.zip'}
    for src in sorted((case_dir / 'sources').iterdir()):
        if src.is_file() and src.suffix.lower() in allowed:
            shutil.copy2(src, docs / src.name)
            artifacts.append({'name': src.name, 'bytes': src.stat().st_size, 'url': '/sources/' + src.name,
                              'sha256': hashlib.sha256(src.read_bytes()).hexdigest()})
    data['artifacts'] = artifacts
    data['generated_at'] = datetime.now(timezone.utc).isoformat()
    data['updated_label'] = '23 октября 2026'
    data['owner_id'] = 'P001'
    (out / 'data').mkdir(exist_ok=True)
    (out / 'data' / 'family.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    (out / 'robots.txt').write_text('User-agent: *\nDisallow: /\n', encoding='utf-8')
    (out / 'healthz').write_text('ok\n', encoding='utf-8')
    print(f'Built {len(data["people"])} people, {len(data["sources"])} sources, {len(artifacts)} source files into {out}')

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--case', type=Path, default=ROOT.parent / 'Genealogy')
    ap.add_argument('--out', type=Path, default=ROOT / 'dist')
    args = ap.parse_args()
    build(args.case, args.out)
