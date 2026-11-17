# teste visual da etapa 5 no mock: Produção, peça, encerramento, falhas
import sys
from playwright.sync_api import sync_playwright
import os
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saida'); os.makedirs(S, exist_ok=True)
erros = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page(viewport={'width': 1400, 'height': 900})
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and erros.append(m.text))
    base = 'http://localhost:8777/_mock.html'
    pg.goto(base + '#/producao'); pg.wait_for_selector('.col'); pg.wait_for_timeout(400)
    cols = pg.eval_on_selector_all('.col', 'cs => cs.map(c => c.dataset.status + ":" + c.querySelectorAll(".op").length)')
    print('colunas', cols)
    assert pg.locator('.op .pill.p-revisao').count() > 0, 'sem selo de revisão'
    pg.screenshot(path=os.path.join(S, 't5_producao.png'))
    pg.locator('.op').first.click(); pg.wait_for_selector('#dlg[open]')
    assert pg.locator('select[name=formato]').count() == 1, 'sem campo formato'
    pg.screenshot(path=os.path.join(S, 't5_peca.png'))
    pg.click('#dlgf button[value=cancelar]')
    pg.goto(base + '#/projeto/pr1'); pg.wait_for_selector('#encerrar')
    pg.click('#encerrar'); pg.wait_for_selector('#dlg[open]'); pg.wait_for_timeout(300)
    pend = pg.locator('#dlgf ul li').count(); print('pendências', pend)
    with pg.expect_download() as d: pg.click('#csvEnt')
    csv = open(d.value.path(), encoding='utf-8-sig').read().splitlines(); print('csv', d.value.suggested_filename, len(csv), 'linhas;', csv[0]); print(' ', csv[1])
    pg.screenshot(path=os.path.join(S, 't5_encerrar.png'))
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(300)
    assert pg.locator('#dlg[open]').count() == 1, 'arquivou sem marcar a confirmação das pendências'
    pg.check('#dlgf input[type=checkbox]'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    assert pg.locator('#dlg[open]').count() == 0, 'não fechou ao confirmar'
    pg.goto(base + '#/configuracoes'); pg.wait_for_selector('[data-resolvida]')
    pg.screenshot(path=os.path.join(S, 't5_config.png'), full_page=False)
    for r in ['', 'projetos', 'relatorios', 'financeiro', 'tarefas']:
        pg.goto(base + '#/' + r); pg.wait_for_timeout(600)
        if 'Não consegui carregar' in pg.inner_text('main'): erros.append('falhou ' + r)
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.goto(base + '#/producao'); pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(S, 't5_celular.png'))
    b.close()
print('ERROS:', erros or 'nenhum')
sys.exit(1 if erros else 0)
