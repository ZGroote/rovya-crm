import sys
from playwright.sync_api import sync_playwright
import os
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saida'); os.makedirs(S, exist_ok=True)
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page()
    pg.goto('http://localhost:8777/_mock.html#/'); pg.wait_for_selector('h1'); pg.evaluate('navigator.serviceWorker.ready'); pg.reload(); pg.wait_for_selector('h1')
    velho = 'Thu, 01 Jan 2026 12:00:00 GMT'
    pg.evaluate("""async v => { const c = await caches.open('rovya-v1'), novo = new Date(Date.now() - 864e5).toUTCString();
      await c.put('https://x.supabase.co/rest/v1/crm_clientes?select=*&id=eq.apagado', new Response('[]', { headers: { date: v } }));
      await c.put('https://x.supabase.co/functions/v1/crm-google?__corpo=diaantigo', new Response('{}', { headers: { date: v } }));
      await c.put('https://x.supabase.co/rest/v1/crm_tarefas?select=*', new Response('[]', { headers: { date: novo } }));
      await c.put(location.origin + '/login.html', new Response('<p>login</p>', { headers: { date: v } })); }""", velho)
    pg.evaluate("navigator.serviceWorker.controller.postMessage({ limpar: 30 })"); pg.wait_for_timeout(1500)
    tem = lambda u: pg.evaluate("async u => !!(await (await caches.open('rovya-v1')).match(u))", u)
    ok(not tem('https://x.supabase.co/rest/v1/crm_clientes?select=*&id=eq.apagado'), 'consulta de 40+ dias sai')
    ok(not tem('https://x.supabase.co/functions/v1/crm-google?__corpo=diaantigo'), 'agenda de dia antigo sai')
    ok(tem('https://x.supabase.co/rest/v1/crm_tarefas?select=*'), 'consulta de ontem fica')
    ok(tem('http://localhost:8777/login.html'), 'tela de login antiga fica (arquivo do app)')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
