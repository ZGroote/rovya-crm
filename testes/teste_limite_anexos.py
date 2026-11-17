import sys
from playwright.sync_api import sync_playwright
import os
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saida'); os.makedirs(S, exist_ok=True)
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
grande = os.path.join(S, 'video-cliente.mp4')
pequeno = os.path.join(S, 'arte.png')
open(grande, 'wb').write(b'0' * (60 * 1048576)); open(pequeno, 'wb').write(b'0' * (2 * 1048576))  # 60 MB passa do limite; 2 MB não
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page(viewport={'width': 1400, 'height': 900})
    pg.on('pageerror', lambda e: erros.append('pageerror: ' + str(e)))
    base = 'http://localhost:8777/_mock.html'
    # entrega
    pg.goto(base + '#/producao'); pg.wait_for_selector('.op'); pg.locator('.op').first.click(); pg.wait_for_selector('#dlg[open] #arq')
    ok('até 50 MB por arquivo' in pg.inner_text('#dlgf'), 'entrega mostra o limite')
    pg.set_input_files('#arq', [pequeno, grande]); pg.wait_for_timeout(200)
    t = pg.inner_text('#toast'); print('     toast:', t)
    ok('video-cliente.mp4' in t and '50 MB' in t and 'Drive' in t, 'avisa o arquivo grande e indica o Drive')
    ok(pg.evaluate("document.querySelector('#arq').files.length") == 0, 'seleção limpa (nada grande vai junto)')
    pg.set_input_files('#arq', [pequeno]); pg.wait_for_timeout(200)
    ok(pg.evaluate("document.querySelector('#arq').files.length") == 1, 'arquivo de 2 MB fica selecionado')
    pg.screenshot(path=os.path.join(S, 't6d.png'))
    pg.click('#dlgf button[value=cancelar]')
    # contrato
    pg.goto(base + '#/contrato/k1'); pg.reload(); pg.wait_for_selector('#arq', state='attached')
    pg.evaluate("window.__log.length = 0; window.__up = 0")
    pg.set_input_files('#arq', [grande]); pg.wait_for_timeout(300)
    ok('50 MB' in pg.inner_text('#toast'), 'contrato: avisa o arquivo grande')
    ok(not any(t == 'crm_contratos' and k == 'update' for t, k, a in pg.evaluate('window.__log')), 'contrato: não gravou o arquivo grande')
    pg.set_input_files('#arq', [pequeno]); pg.wait_for_timeout(2000); print('     log:', [x[:2] for x in pg.evaluate('window.__log')][-6:], pg.inner_text('#toast'))
    ok(any(t == 'crm_contratos' and k == 'update' for t, k, a in pg.evaluate('window.__log')), 'contrato: arquivo de 2 MB anexado')
    b.close()
os.remove(grande); os.remove(pequeno)
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
