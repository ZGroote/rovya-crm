# Roda todos os testes do CRM no navegador (Playwright + Chrome do sistema), com dados de mentira.
#   python testes/rodar.py              todos
#   python testes/rodar.py producao     só os que têm "producao" no nome
# Precisa: pip install playwright, Google Chrome instalado e supabase/002_seed.sql no computador (fica fora do git).
# Capturas de tela e arquivos temporários ficam em testes/saida (fora do git).
import os, sys, glob, subprocess, threading, functools, http.server, time
AQUI = os.path.dirname(os.path.abspath(__file__)); RAIZ = os.path.dirname(AQUI)
filtro = sys.argv[1] if len(sys.argv) > 1 else ''

subprocess.run([sys.executable, os.path.join(AQUI, 'mock.py')], check=True, cwd=RAIZ)  # gera _mock.html + _mock/config.js

class Quieto(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8777), functools.partial(Quieto, directory=RAIZ))
threading.Thread(target=srv.serve_forever, daemon=True).start()

env = {**os.environ, 'PYTHONIOENCODING': 'utf-8'}
resultado = {}
for t in sorted(glob.glob(os.path.join(AQUI, 'teste_*.py')) + glob.glob(os.path.join(AQUI, 'teste_*.mjs'))):  # .mjs: funções do Supabase no Node
    nome = os.path.splitext(os.path.basename(t))[0][6:]
    if filtro not in nome: continue
    t0 = time.time()
    r = subprocess.run(['node', '--no-warnings', t] if t.endswith('.mjs') else [sys.executable, t], capture_output=True, text=True, encoding='utf-8', env=env, cwd=RAIZ)
    resultado[nome] = r.returncode == 0
    print(f"{'OK   ' if r.returncode == 0 else 'FALHA'} {nome} ({time.time() - t0:.0f} s)")
    if r.returncode: print('\n'.join('      ' + l for l in (r.stdout + r.stderr).strip().splitlines()[-15:]))
srv.shutdown()
falhas = [n for n, ok in resultado.items() if not ok]
print(f'\n{len(resultado) - len(falhas)} de {len(resultado)} passaram' + (f'; falharam: {", ".join(falhas)}' if falhas else ''))
sys.exit(1 if falhas else 0)
