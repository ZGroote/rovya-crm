# Supabase de verdade (sem login, só leitura anônima): sem internet e com a sessão salva vencida há 2 dias,
# o login responde na hora (config.js) e a consulta sai da cópia do aparelho (sw.js), sem a espera de ~25 s do auth-js.
import os, sys
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGINA = os.path.join(RAIZ, '_mock_offline.html')  # fora do git (.gitignore: _mock*)
open(PAGINA, 'w', encoding='utf-8').write('''<!doctype html><meta charset="utf-8"><title>teste</title><script type="module">
import { sb } from './config.js';
navigator.serviceWorker.register('sw.js');
window.consultar = async () => { const t0 = performance.now(); const s = await sb.auth.getSession(); const t1 = performance.now();
  const r = await sb.from('crm_clientes').select('id').limit(1);
  return { sessao: !!s.data.session, msSessao: Math.round(t1 - t0), msConsulta: Math.round(performance.now() - t1), data: r.data, erro: r.error?.message || null }; };
window.pronto = true;
</script>''')
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
        ctx = b.new_context(); pg = ctx.new_page()
        u = 'http://localhost:8777/_mock_offline.html'
        pg.goto(u); pg.wait_for_function('window.pronto'); pg.evaluate('navigator.serviceWorker.ready')
        pg.reload(); pg.wait_for_function('window.pronto'); pg.wait_for_timeout(500)
        r = pg.evaluate('consultar()'); print('     com internet, sem login:', r)
        ok(r['erro'] is None, 'consulta anônima funciona com internet (fica na cópia)')
        pg.evaluate("""localStorage.setItem('sb-jgigosrsyxjqqhckudfe-auth-token', JSON.stringify({access_token:'velho', refresh_token:'r', token_type:'bearer', expires_in:3600,
          expires_at: Math.floor(Date.now()/1000) - 172800, user:{id:'u1', email:'x@y.z', aud:'authenticated', app_metadata:{}, user_metadata:{}, created_at:'2026-01-01'}}))""")
        ctx.set_offline(True)
        pg.reload(); pg.wait_for_function('window.pronto', timeout=15000)
        r = pg.evaluate('consultar()'); print('     sem internet, sessão vencida:', r)
        ok(r['sessao'] and r['msSessao'] < 1500, 'sessão vencida responde na hora sem internet')
        ok(r['erro'] is None and r['data'] == [], 'consulta sai da cópia do aparelho')
        b.close()
finally:
    os.remove(PAGINA)
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
