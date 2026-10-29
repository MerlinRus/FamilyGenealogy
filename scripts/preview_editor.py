"""Local UI preview with an isolated editor database, never production data."""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server.app import Handler, Store
ROOT=Path(__file__).resolve().parents[1]
port=int(os.environ.get('FAMILY_PREVIEW_PORT','4181'))
os.environ['FAMILY_ORIGIN']='http://127.0.0.1:'+str(port)
class Preview(Handler,SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path=='/data/family.json': self.path='/api/data'
        if self.path.startswith('/api/'): Handler.do_GET(self)
        else: SimpleHTTPRequestHandler.do_GET(self)
server=ThreadingHTTPServer(('127.0.0.1',port),partial(Preview,directory=str(ROOT/'dist')))
server.store=Store(ROOT/'dist/data/family.json',ROOT/'.private/preview-editor.sqlite3')
server.serve_forever()
