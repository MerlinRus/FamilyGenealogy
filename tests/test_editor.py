import copy
import json
import tempfile
import unittest
from pathlib import Path
from server.app import Store

class EditingTests(unittest.TestCase):
    def setUp(self):
        parent=Path(__file__).resolve().parents[1]/'.private'/'test-temp'
        parent.mkdir(parents=True,exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(dir=parent)
        self.root=Path(self.tmp.name)
        self.base={'people':[{'id':'P1','name':'Тестовый родственник'}], 'sources':[], 'claims':[], 'relationships':[], 'candidate_links':[], 'presentation':{'people':{'P1':{'summary':'Исходное описание'}},'candidates':{},'sources':{}}}
        self.path=self.root/'base.json'
        self.path.write_text(json.dumps(self.base),encoding='utf-8')
        self.store=Store(self.path,self.root/'editor.sqlite3')
    def tearDown(self): self.tmp.cleanup()
    def payload(self,changes,revision=0): return dict(revision=revision,reason='Знаю лично',changes=changes)
    def edit(self,**fields): return {'collection':'people','id':'P1','fields':fields}
    def test_persistent_edit_does_not_modify_research(self):
        self.store.write(self.payload([self.edit(name='Исправленное имя')]))
        self.assertEqual(Store(self.path,self.root/'editor.sqlite3').read()['people'][0]['name'],'Исправленное имя')
        self.assertEqual(json.loads(self.path.read_text()),self.base)
    def test_stale_write_cannot_overwrite_newer_value(self):
        self.store.write(self.payload([self.edit(name='Первая правка')]))
        with self.assertRaises(RuntimeError): self.store.write(self.payload([self.edit(name='Устаревшая правка')]))
        self.assertEqual(self.store.read()['people'][0]['name'],'Первая правка')
    def test_undo_is_logged_and_restores_previous_value(self):
        self.store.write(self.payload([self.edit(name='Новое имя')]))
        self.store.write(dict(revision=1,reason='Отмена'),undo=True)
        self.assertEqual(self.store.read()['people'],self.base['people'])
        self.assertEqual(len(self.store.history()),2)
    def test_source_link_validation_rolls_back_whole_transaction(self):
        with self.assertRaises(ValueError): self.store.write(self.payload([self.edit(name='Не должно сохраниться'),dict(collection='claims',id='C1',fields=dict(person_id='P1',source_ids=['MISSING']))]))
        self.assertEqual(self.store.read()['editing']['revision'],0)
    def test_update_survives_new_research_release(self):
        self.store.write(self.payload([self.edit(name='Имя владельца')]))
        self.base['people'].append({'id':'P2','name':'Новая находка'})
        self.base['presentation']['people']['P2']={'summary':'Новая находка'}
        self.path.write_text(json.dumps(self.base),encoding='utf-8')
        self.assertEqual([p['name'] for p in self.store.read()['people']],['Имя владельца','Новая находка'])
    def test_prevents_cycles_and_proof_promotion(self):
        with self.assertRaises(ValueError): self.store.write(self.payload([dict(collection='relationships',id='R1',fields=dict(parent_id='P1',child_id='P1'))]))
        with self.assertRaises(ValueError): self.store.write(self.payload([dict(collection='claims',id='C1',fields=dict(status='confirmed'))]))
    def test_arbitrary_fields_and_nontext_values_rejected(self):
        for fields in [dict(id='oops'),dict(name={'object':True})]:
            with self.assertRaises(ValueError): self.store.write(self.payload([self.edit(**fields)]))
    def test_http_rejects_cross_origin_and_stale_writes(self):
        import threading
        import urllib.request
        import urllib.error
        from http.server import ThreadingHTTPServer
        from server.app import Handler
        http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        http.store=self.store
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        def post(headers):
            req=urllib.request.Request(f'http://127.0.0.1:{http.server_port}/api/edit',data=json.dumps(self.payload([self.edit(name='Новое имя')])).encode(),headers=headers)
            try:
                with urllib.request.urlopen(req) as r:return r.status
            except urllib.error.HTTPError as e:return e.code
        try:
            self.assertEqual(post({}),403)
            self.assertEqual(post({'X-Family-Edit':'1','Origin':'https://unrelated.example'}),403)
            self.assertEqual(post({'X-Family-Edit':'1'}),200)
            self.assertEqual(post({'X-Family-Edit':'1'}),409)
        finally:http.shutdown();http.server_close();thread.join()

if __name__=='__main__':unittest.main()
