# Cliente sem pasta no Drive: "Criar pasta nova" ou "Usar pasta que já existe" (janela do Google Picker, aqui de mentira).
# Usando a existente, as subpastas são criadas dentro dela e o cliente fica ligado a ela; o contrato pergunta o mesmo.
import sys, json
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
PICKER = """window.gapi = { load: (n, o) => o.callback() };
window.google = { picker: { ViewId: { FOLDERS: 'f' }, Action: { PICKED: 'picked', CANCEL: 'cancel' },
  DocsView: function () { this.setSelectFolderEnabled = () => this; this.setIncludeFolders = () => this; this.setMimeTypes = () => this; },
  PickerBuilder: function () { const b = this; let cb; window.__picker = {};
    for (const k of ['addView', 'setOAuthToken', 'setDeveloperKey', 'setAppId', 'setLocale', 'setTitle']) b[k] = v => { window.__picker[k] = v; return b; };
    b.setCallback = f => { cb = f; return b; };
    b.build = () => ({ setVisible: () => setTimeout(() => cb(window.__escolha === null ? { action: 'cancel' } : { action: 'picked', docs: [{ id: window.__escolha || 'pastaVelha' }] }), 50) }); } } };"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))
    criadas = []
    def drive(route):
        r = route.request
        if r.method == 'POST': d = json.loads(r.post_data); criadas.append(d); route.fulfill(json={'id': 'sub' + str(len(criadas))})
        else: route.fulfill(json={'trashed': False})
    pg.route('https://apis.google.com/js/api.js', lambda r: r.fulfill(body=PICKER, content_type='text/javascript'))
    pg.route('https://www.googleapis.com/drive/v3/files**', drive)
    sem_pasta = "window.__D.crm_clientes.forEach(c => { c.drive_pasta = null; c.drive_subpastas = {}; }); location.hash = '#/funil'; setTimeout(() => location.hash = '#/cliente/c1', 300)"
    pg.goto('http://localhost:8777/_mock.html#/funil'); pg.wait_for_timeout(500); pg.evaluate(sem_pasta); pg.wait_for_selector('#cartaoDrive [data-drive=pasta]')
    pg.evaluate("""(() => { const f0 = window.fetch; window.fetch = (u, o) => String(u).includes('functions/v1') && JSON.parse(o.body).acao === 'token'
      ? Promise.resolve(new Response(JSON.stringify({ token: 'at', drive: true, picker: { chave: 'AIzaX', app: '123' } }))) : f0(u, o); })()""")
    pg.click('#cartaoDrive [data-drive=pasta]'); pg.wait_for_selector('#dlg[open]')
    ok(pg.locator('#dlgf button[value=existente]').count() == 1 and 'Criar pasta nova' in pg.inner_text('#dlgf button[value=ok]'), 'oferece criar nova ou usar a que já existe')
    pg.screenshot(path='testes/saida/pasta_existente.png')
    pg.evaluate('window.__log.length = 0')
    pg.click('#dlgf button[value=existente]'); pg.wait_for_selector('#dlg[open] [data-sub]', timeout=5000)
    ok(pg.evaluate('window.__picker.setDeveloperKey') == 'AIzaX' and pg.evaluate('window.__picker.setOAuthToken') == 'at' and pg.evaluate('window.__picker.setAppId') == '123', 'abre a janela do Google com a chave, o token e o projeto')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(800)
    ok(criadas and [c['name'][:2] for c in criadas if c.get('parents') == ['pastaVelha']] == ['01', '02', '03', '11', '12'] and all(c.get('parents') == ['RAIZ'] for c in criadas if '—' in c['name']), f'subpastas criadas dentro da pasta escolhida: {[(c["name"], c.get("parents")) for c in criadas]}')
    ok(not any(c['name'].startswith('CLIENTE_') for c in criadas), 'não cria pasta CLIENTE_ nova')
    upd = [a[0] for t, k, a in pg.evaluate('window.__log') if t == 'crm_clientes' and k == 'update']
    ok(upd and upd[-1]['drive_pasta'] == 'pastaVelha' and len(upd[-1]['drive_subpastas']) == 5, f'cliente fica ligado à pasta escolhida: {upd and upd[-1]}')
    # cancelar a janela do Google: nada muda
    pg.evaluate(sem_pasta); pg.wait_for_timeout(900); pg.wait_for_selector('#cartaoDrive [data-drive=pasta]')
    pg.evaluate("window.__escolha = null; window.__log.length = 0")
    n = len(criadas); pg.click('#cartaoDrive [data-drive=pasta]'); pg.wait_for_selector('#dlg[open]'); pg.click('#dlgf button[value=existente]'); pg.wait_for_timeout(800)
    ok(len(criadas) == n and not [1 for t, k, a in pg.evaluate('window.__log') if t == 'crm_clientes' and k == 'update'], 'fechou a janela do Google: nada é criado')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
