# Financeiro (12 meses + seletor de ano), Funil (fechados de 3 meses), Projetos (arquivados escondidos)
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
    pg = b.new_page(viewport={'width': 1400, 'height': 900})
    pg.on('pageerror', lambda e: erros.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and erros.append('console: ' + m.text))
    base = 'http://localhost:8777/_mock.html'
    log = lambda t: [(k, a) for tt, k, a in pg.evaluate('window.__log') if tt == t]
    # Financeiro
    pg.goto(base + '#/financeiro'); pg.wait_for_selector('#periodo')
    l = log('crm_parcelas')
    ok(any(k == 'or' and 'pago_em.is.null,vencimento.gte.' in a[0] for k, a in l), 'financeiro abre com em aberto + últimos 12 meses')
    anos = pg.eval_on_selector_all('#periodo option', 'os => os.map(o => o.textContent)')
    print('     períodos:', anos)
    ok(anos[0].startswith('Últimos 12 meses') and '2026' in anos, 'seletor de período com os anos')
    pg.evaluate('window.__log.length = 0'); pg.select_option('#periodo', '2026'); pg.wait_for_timeout(600)
    l = log('crm_parcelas')
    ok(('gte', ['vencimento', '2026-01-01']) in l and ('lte', ['vencimento', '2026-12-31']) in l, 'escolher 2026 busca o ano inteiro')
    ok(pg.eval_on_selector('#periodo', 's => s.value') == '2026', 'período continua escolhido')
    pg.click('[data-f=todas]'); pg.wait_for_timeout(500)
    ok(pg.eval_on_selector('#periodo', 's => s.value') == '2026' and pg.locator('tbody tr').count() > 0, 'trocar de aba mantém o ano e mostra a lista')
    pg.screenshot(path=os.path.join(S, 't6g_fin.png'))
    # Funil
    pg.evaluate('window.__log.length = 0'); pg.goto(base + '#/funil'); pg.wait_for_timeout(700)
    ok(any(k == 'or' and 'etapa.not.in.(ganho,perdido),atualizado_em.gte.' in a[0] for k, a in log('crm_oportunidades')), 'funil: fechados/perdidos só dos últimos 3 meses')
    ok('Fechados e perdidos ficam ocultos' in pg.inner_text('main') and 'últimos 3 meses' in pg.inner_text('main'), 'funil explica o recorte')
    # Projetos
    pg.evaluate('window.__log.length = 0'); pg.goto(base + '#/projetos'); pg.wait_for_timeout(600)
    ok(('neq', ['status', 'arquivado']) in log('crm_projetos'), 'projetos escondem os arquivados')
    pg.click('text=Mostrar arquivados'); pg.wait_for_timeout(600)
    ok(pg.url.endswith('#/projetos/arquivados') and pg.locator('text=Esconder arquivados').count() == 1, 'botão mostra os arquivados')
    pg.evaluate('window.__log.length = 0'); pg.reload(); pg.wait_for_timeout(800)
    ok(('neq', ['status', 'arquivado']) not in log('crm_projetos'), 'com arquivados, a busca não filtra')
    ok(pg.locator('#nav a.on').inner_text().strip().endswith('Projetos'), 'menu continua em Projetos')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
