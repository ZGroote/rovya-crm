# Aba Links (links da bio, rovyacreative.com.br/links): lista na ordem, cria, valida o link, reordena, esconde e apaga.
import sys
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}); pg = ctx.new_page(); pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))
    log = lambda k: [a for t, kk, a in pg.evaluate('window.__log') if t == 'crm_links' and kk == k]
    pg.goto('http://localhost:8777/_mock.html#/links'); pg.wait_for_selector('.links-bio li')
    menu = [m.split('\n')[-1].strip() for m in pg.locator('#nav a').all_inner_texts()]
    ok('Links' in menu and pg.locator('#nav a.on').inner_text().strip().endswith('Links'), 'aba Links no menu')
    itens = pg.locator('.links-bio li b').all_inner_texts()
    ok(itens == ['Agende uma primeira conversa', 'Conheça a ROVYA', 'Revista'] and pg.locator('.links-bio li.oculto').count() == 1, f'lista na ordem, a escondida apagadinha: {itens}')
    ok(pg.locator('.links-bio li >> nth=0 >> [data-sobe]').is_disabled() and pg.locator('.links-bio li >> nth=2 >> [data-desce]').is_disabled(), 'primeiro não sobe, último não desce')
    pg.screenshot(path='testes/saida/links_crm.png')
    # novo: link inválido é recusado
    pg.evaluate('window.__log.length = 0'); pg.click('#lNovo'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=titulo]', 'Revista'); pg.fill('#dlgf [name=url]', 'javascript:alert(1)'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(400)
    ok(not log('insert'), 'link que não começa com https:// é recusado')
    pg.click('#lNovo'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=titulo]', 'Revista de novembro'); pg.fill('#dlgf [name=url]', 'https://issuu.com/rovya/nov'); pg.fill('#dlgf [name=descricao]', 'Leia online')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    ins = log('insert')
    ok(ins and ins[0][0] == {'titulo': 'Revista de novembro', 'url': 'https://issuu.com/rovya/nov', 'descricao': 'Leia online', 'destaque': False, 'ativo': True, 'ordem': 4}, f'novo link vai para o fim, ativo: {ins and ins[0][0]}')
    # reordenar: desce o primeiro
    pg.evaluate('window.__log.length = 0'); pg.click('.links-bio li >> nth=0 >> [data-desce]'); pg.wait_for_timeout(500)
    ups = log('update'); eqs = [a for a in log('eq')]
    ok(ups == [[{'ordem': 2}], [{'ordem': 1}]] and eqs[:2] == [['id', 'l1'], ['id', 'l2']], f'↓ troca a posição dos dois: {ups} {eqs[:2]}')
    # esconder pelo editar
    pg.evaluate('window.__log.length = 0'); pg.click('.links-bio li >> nth=1 >> [data-editar]'); pg.wait_for_selector('#dlg[open]')
    ok(pg.input_value('#dlgf [name=titulo]') == 'Conheça a ROVYA', 'editar abre preenchido')
    pg.select_option('#dlgf [name=ativo]', ''); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    ok(log('update') and log('update')[0][0]['ativo'] is False, 'esconder da página grava ativo = falso')
    # apagar pede confirmação
    pg.evaluate('window.__log.length = 0'); pg.click('.links-bio li >> nth=2 >> [data-editar]'); pg.wait_for_selector('#dlg[open]')
    pg.click('#dlgf button[value=apagar]'); pg.wait_for_timeout(300); ok('Apagar' in pg.inner_text('#dlgf h2'), 'apagar pede confirmação')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500); ok(log('delete'), 'confirmou: apaga')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
