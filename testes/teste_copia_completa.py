# cópia completa: o quadro invisível passa por todas as telas e fichas, marca a hora e some
import sys, time
from playwright.sync_api import sync_playwright
import os
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saida'); os.makedirs(S, exist_ok=True)
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page()
    pg.on('pageerror', lambda e: erros.append('pageerror: ' + str(e)))
    base = 'http://localhost:8777/_mock.html'
    pg.goto(base + '#/clientes'); pg.wait_for_selector('h1'); pg.evaluate('navigator.serviceWorker.ready')
    pg.evaluate("localStorage.removeItem('rovya-copia-em')"); pg.reload(); pg.wait_for_selector('h1')
    pg.click('h1')  # cursor na página principal
    vistos, falhas, controlado, t0 = [], [], None, time.time()
    while time.time() - t0 < 60:
        pg.wait_for_timeout(100)
        for f in pg.frames[1:]:
            try:
                h = f.url.split('#')[-1]
                if controlado is None: controlado = f.evaluate('!!navigator.serviceWorker.controller')
                if 'Não consegui carregar' in f.inner_text('main', timeout=200): falhas.append(h)
                if not vistos or vistos[-1] != h: vistos.append(h)
            except Exception: pass
        if pg.evaluate("localStorage.getItem('rovya-copia-em')"): break
    print('rotas vistas:', len(vistos), vistos)
    ok(pg.evaluate("localStorage.getItem('rovya-copia-em')") is not None, 'cópia marcada como completa')
    ok(controlado, 'quadro controlado pelo service worker (as respostas vão para a cópia)')
    for r in ['/funil', '/financeiro', '/configuracoes', '/cliente/c1', '/cliente/c3', '/projeto/pr1', '/contrato/k1', '/proposta/pp2']:
        ok(r in vistos, 'passou por ' + r)
    ok('/assistente' not in vistos, 'não abriu o Assistente (não gasta IA)')
    ok(not falhas, 'nenhuma tela falhou no quadro: ' + str(sorted(set(falhas))))
    pg.wait_for_timeout(300)
    ok(len(pg.frames) == 1, 'quadro removido no fim')
    ok(pg.evaluate("document.activeElement.tagName") != 'IFRAME', 'o quadro não roubou o foco')
    ok(pg.url.endswith('#/clientes') and 'Clientes' in pg.inner_text('h1'), 'tela da Sabrina não mudou durante a cópia')
    ctx.set_offline(True); pg.wait_for_timeout(300)
    faixa = pg.evaluate("getComputedStyle(document.querySelector('#main'), '::before').content")
    ok('Cópia completa de' in faixa, 'faixa sem internet mostra a hora da cópia: ' + faixa[:140])
    pg.screenshot(path=os.path.join(S, 't6c.png'))
    # menos de 30 min depois: não copia de novo
    ctx.set_offline(False); pg.reload(); pg.wait_for_timeout(12000)
    ok(len(pg.frames) == 1, 'não repete a cópia antes de 30 min')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
