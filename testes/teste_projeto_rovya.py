# Projeto da própria Rovya (interno, sem cliente): opção no "+ Projeto" e telas que mostram "Rovya" no lugar do cliente.
import sys
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))
    pg.goto('http://localhost:8777/_mock.html#/projetos'); pg.wait_for_selector('#nProj')
    pg.evaluate("""(async () => { const cfg = await import('/_mock/config.js'); const r0 = cfg.sb.rpc;
      window.__rpc = []; cfg.sb.rpc = (n, a) => { window.__rpc.push([n, a]); return r0(n, a); }; })()""")
    pg.click('#nProj'); pg.wait_for_selector('#dlg[open]')
    ok(pg.locator('#dlgf [name=c] option').first.inner_text() == 'Rovya (projeto interno)', 'primeira opção é a Rovya')
    ok(pg.locator('#dlgf [name=c] option').count() > 1, 'os clientes continuam na lista')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_selector('#dlgf [name=nome]')
    ok(pg.input_value('#dlgf [name=nome]') == '', 'projeto interno começa sem nome sugerido')
    pg.fill('#dlgf [name=nome]', 'Revista Rovya'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    r = pg.evaluate("window.__rpc.filter(([n]) => n === 'crm_projeto_de_modelo')")
    ok(r and r[-1][1]['p_cliente'] is None and r[-1][1]['p_nome'] == 'Revista Rovya', f'cria o projeto sem cliente: {r and r[-1][1]}')
    # escolher um cliente ainda funciona
    pg.goto('http://localhost:8777/_mock.html#/projetos'); pg.wait_for_selector('#nProj'); pg.click('#nProj'); pg.wait_for_selector('#dlg[open]')
    pg.select_option('#dlgf [name=c]', 'c1'); pg.click('#dlgf button[value=ok]'); pg.wait_for_selector('#dlgf [name=nome]')
    ok(pg.input_value('#dlgf [name=nome]') == 'Imobiliária Horizonte', 'com cliente: sugere o nome da empresa')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    # projeto sem cliente nas telas
    pg.evaluate("window.__D.crm_projetos[0].crm_clientes = null; window.__D.crm_projetos[0].cliente_id = null; location.hash = '#/funil'; setTimeout(() => location.hash = '#/projetos', 300)")
    pg.wait_for_selector('.linkcard'); pg.wait_for_timeout(300)
    ok('Rovya' in pg.inner_text('.linkcard'), 'lista de projetos mostra Rovya')
    pg.click('.linkcard'); pg.wait_for_selector('h1'); pg.wait_for_timeout(300)
    ok(pg.text_content('.topo .eyebrow').strip() == 'Rovya · projeto interno', 'página do projeto mostra Rovya · projeto interno')
    pg.screenshot(path='testes/saida/projeto_rovya.png')
    pg.click('text=Abrir >> nth=0'); pg.wait_for_selector('#dlg[open]')
    ok(pg.locator('#dlgf [name=texto]').count() == 1, 'abrir uma entrega de projeto interno funciona')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.goto('http://localhost:8777/_mock.html#/inicio'); pg.wait_for_timeout(800)
    ok('Rovya' in pg.inner_text('main'), 'Início mostra Rovya no projeto ativo')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
