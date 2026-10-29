"""Private editing API. Immutable research releases + durable, versioned owner edits."""
from contextlib import contextmanager
import copy
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

COLLECTIONS = {
    'people': {'name', 'living', 'role'},
    'claims': {'person_id', 'fact', 'value', 'status', 'source_ids', 'evidence_quote', 'reasoning', 'current', 'user_certainty'},
    'sources': {'title', 'kind', 'repository', 'origin_id', 'locator', 'url', 'date_accessed', 'viewed_original', 'notes'},
    'relationships': {'parent_id', 'child_id', 'type', 'status', 'source_ids', 'reasoning', 'direct_evidence', 'evidence_quote', 'user_certainty'},
    'candidate_links': {'candidate_id', 'target_id', 'status', 'source_ids', 'reasoning', 'relation_type', 'priority'},
    'presentation.people': {'relationship', 'summary', 'category', 'family_hypothesis', 'certainty'},
    'presentation.candidates': {'label', 'question', 'conclusion', 'matches', 'objections', 'next_step', 'document_ids', 'comparison', 'record_label', 'decision'},
    'presentation.sources': {'title', 'group', 'kind_label', 'summary', 'limit', 'person_ids', 'primary_file', 'reading_hint', 'pdf_page', 'extracted'},
}

def table(data, name):
    if name.startswith('presentation.'):
        return data['presentation'][name.split('.')[1]]
    return {r['id']: r for r in data[name]}

def merge(base, overrides):
    data = copy.deepcopy(base)
    for collection, rows in overrides.items():
        target = table(data, collection)
        for key, fields in rows.items():
            if key in target:
                target[key].update(fields)
            else:
                record = dict(id=key, **fields) if '.' not in collection else dict(fields)
                if '.' in collection: target[key] = record
                else: data[collection].append(record)
    return data

def validate(data):
    people = {p['id'] for p in data['people']}
    sources = {s['id'] for s in data['sources']}
    for collection in ['people', 'sources', 'claims', 'relationships', 'candidate_links']:
        rows = data[collection]
        if len({x['id'] for x in rows}) != len(rows): raise ValueError('Повтор записи')
    for p in data['people']:
        if not isinstance(p.get('name'), str) or not p['name'].strip(): raise ValueError('Нужно имя человека')
        if p['id'] not in data['presentation']['people'] and p['id'] not in data['presentation']['candidates']: raise ValueError('Нужно описание человека')
    for c in data['claims']:
        if c.get('person_id') not in people or not c.get('source_ids') or set(c['source_ids']) - sources: raise ValueError('Укажите существующий источник факта')
        if c.get('user_certainty', 'unknown') not in ['known', 'hypothesis', 'unknown', 'documented']: raise ValueError('Неизвестная оценка')
    parents = {}
    for r in data['relationships']:
        if r.get('parent_id') not in people or r.get('child_id') not in people: raise ValueError('Неизвестный родственник')
        parents.setdefault(r['child_id'], []).append(r['parent_id'])
    def visit(pid, path):
        if pid in path: raise ValueError('Родственная связь создаёт цикл')
        for parent in parents.get(pid, []): visit(parent, path | {pid})
    for pid in people: visit(pid, set())
    for h in data['candidate_links']:
        if h.get('target_id') not in people or h.get('candidate_id') not in people: raise ValueError('Неизвестный человек в версии')
        c = data['presentation']['candidates'].get(h['candidate_id'], {})
        if not all(c.get(k) for k in ['conclusion', 'matches', 'objections', 'next_step', 'comparison']): raise ValueError('Заполните объяснение версии')
        if set(c.get('document_ids', [])) - sources: raise ValueError('Неизвестный документ версии')
    for s in data['sources']:
        u = data['presentation']['sources'].get(s['id'], {})
        if not all(u.get(k) for k in ['title', 'group', 'kind_label', 'summary', 'limit']): raise ValueError('Заполните описание источника')
        if set(u.get('person_ids', [])) - people: raise ValueError('Неизвестный человек в источнике')
        if s.get('url') and not s['url'].startswith(('https://', 'http://')): raise ValueError('Ссылка должна начинаться с https:// или http://')

class Store:
    def __init__(self, base_path, db_path):
        self.base_path, self.db_path = Path(base_path), Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        # ponytail: one family workspace; serialize writes, use DB row versions if multi-workspace later.
        self.lock = threading.Lock()
        with self.connect() as db:
            db.executescript('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER, content TEXT);'
                             'INSERT OR IGNORE INTO state VALUES(1,0,\'{}\');'
                             'CREATE TABLE IF NOT EXISTS events (revision INTEGER PRIMARY KEY, time TEXT, reason TEXT, before TEXT, after TEXT);')
    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db_path, timeout=20)
        db.execute('PRAGMA journal_mode=WAL')
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()
    def read(self):
        with self.connect() as db: revision, content = db.execute('SELECT revision,content FROM state WHERE id=1').fetchone()
        base = json.loads(self.base_path.read_text(encoding='utf-8'))
        data = merge(base, json.loads(content))
        data['editing'] = {'revision': revision, 'enabled': True}
        return data
    def history(self):
        base=json.loads(self.base_path.read_text(encoding='utf-8'))
        labels={'name':'Имя','living':'Жив / умер','summary':'Описание','conclusion':'Вывод версии','label':'Статус версии','value':'Значение','certainty':'Уверенность','relationship':'Родство','decision':'Решение','parent_id':'Родитель','child_id':'Ребёнок'}
        with self.connect() as db:
            result=[]
            for r,t,s,b,a in db.execute('SELECT revision,time,reason,before,after FROM events ORDER BY revision DESC LIMIT 100'):
                before,after=merge(base,json.loads(b)),merge(base,json.loads(a))
                changes=[]
                for collection in COLLECTIONS:
                    old,new=table(before,collection),table(after,collection)
                    for key in set(old)|set(new):
                        for field,label in labels.items():
                            v1,v2=old.get(key,{}).get(field),new.get(key,{}).get(field)
                            if v1!=v2:changes.append(dict(label=label,before=v1,after=v2))
                result.append(dict(revision=r,time=t,reason=s,changes=changes))
            return result
    def write(self, payload, undo=False):
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            revision, content = db.execute('SELECT revision,content FROM state WHERE id=1').fetchone()
            if payload.get('revision') != revision: raise RuntimeError('Данные уже изменились. Обновите страницу и повторите правку.')
            reason = payload.get('reason', '').strip()
            if not reason or len(reason) > 2000: raise ValueError('Кратко объясните изменение (до 2000 символов)')
            overrides = json.loads(content)
            if undo:
                row = db.execute('SELECT before FROM events ORDER BY revision DESC LIMIT 1').fetchone()
                if not row: raise ValueError('Пока нечего отменять')
                overrides = json.loads(row[0])
            else:
                changes = payload.get('changes', [])
                if not isinstance(changes,list) or not 1 <= len(changes) <= 100: raise ValueError('Некорректный набор правок')
                for change in changes:
                    collection, key, fields = change.get('collection'), change.get('id'), change.get('fields')
                    if collection not in COLLECTIONS or not isinstance(key,str) or not key.isascii() or not key.replace('-','').replace('_','').isalnum(): raise ValueError('Неизвестная запись')
                    if not isinstance(fields,dict) or not fields or set(fields) - COLLECTIONS[collection]: raise ValueError('Недопустимое поле')
                    for field, value in fields.items():
                        if field in {'source_ids','document_ids','person_ids','matches','objections','comparison','extracted'}:
                            if not isinstance(value,list): raise ValueError('Нужен список')
                            if field in {'matches','objections','source_ids','document_ids','person_ids'} and not all(isinstance(x,str) for x in value): raise ValueError('Нужен список строк')
                        elif field not in {'value','living','current','viewed_original','family_hypothesis','direct_evidence','primary_file','pdf_page'} and not isinstance(value,str): raise ValueError('Нужен текст')
                        if field=='comparison' and not all(isinstance(x,dict) and all(isinstance(x.get(k),str) for k in ['label','known','found','result']) and x['result'] in ['match','context','missing','conflict'] for x in value): raise ValueError('Неверное сравнение')
                        if field=='extracted' and not all(isinstance(x,dict) and isinstance(x.get('label'),str) and isinstance(x.get('value'),str) for x in value): raise ValueError('Неверная выдержка')
                        if field=='living' and value is not None and not isinstance(value,bool): raise ValueError('Неверная отметка о жизни')
                    if fields.get('status') == 'confirmed': raise ValueError('Документальная доказательность не назначается личной оценкой')
                    overrides.setdefault(collection, {}).setdefault(key, {}).update(fields)
            base = json.loads(self.base_path.read_text(encoding='utf-8'))
            validate(merge(base, overrides))
            after = json.dumps(overrides, ensure_ascii=False)
            stamp = datetime.now(timezone.utc).isoformat()
            db.execute('INSERT INTO events VALUES(?,?,?,?,?)', (revision+1, stamp, reason, content, after))
            db.execute('UPDATE state SET revision=?,content=? WHERE id=1', (revision+1, after))
        return revision+1

class Handler(BaseHTTPRequestHandler):
    def send_json(self, code, body):
        encoded = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)
    def do_GET(self):
        if self.path == '/api/data': self.send_json(200, self.server.store.read())
        elif self.path == '/api/history': self.send_json(200, self.server.store.history())
        elif self.path == '/api/health': self.send_json(200, {'ok': True})
        else: self.send_json(404, {'error':'Не найдено'})
    def do_POST(self):
        # A cross-origin form cannot set this header; do not allow CORS.
        if self.headers.get('X-Family-Edit') != '1': return self.send_json(403, {'error':'Нужен запрос из редактора'})
        origin = self.headers.get('Origin')
        allowed = os.environ.get('FAMILY_ORIGIN', 'https://family.maark.ru')
        if origin and origin != allowed: return self.send_json(403, {'error':'Другой источник запроса'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 262144: raise ValueError('Слишком большой запрос')
            if self.path not in ['/api/edit','/api/undo']: return self.send_json(404, {'error':'Не найдено'})
            payload = json.loads(self.rfile.read(length))
            rev = self.server.store.write(payload, self.path == '/api/undo')
            self.send_json(200, {'revision': rev})
        except RuntimeError as e: self.send_json(409, {'error':str(e)})
        except (ValueError,KeyError,TypeError,AttributeError,RecursionError): self.send_json(400, {'error':'Проверьте заполнение полей, источники и родственные связи.'})
        except Exception: self.send_json(500, {'error':'Не удалось сохранить. Ваши прежние данные сохранены; повторите позже.'})
    def log_message(self, *_): pass

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('FAMILY_API_PORT','8095'))), Handler)
    server.store = Store(os.environ.get('FAMILY_BASE','/opt/familytree/site/current/data/family.json'), os.environ.get('FAMILY_DB','/opt/familytree/private/editor.sqlite3'))
    server.serve_forever()
