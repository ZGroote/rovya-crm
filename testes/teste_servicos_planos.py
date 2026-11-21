# Serviço com abas Dados · Planos · Documentos; planos na lista de Serviços e no "+ Do catálogo" da proposta.
import sys
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
U = 'http://localhost:8777/_mock.html'
T = lambda s: (s or '').replace('\xa0', ' ')  # o brl() usa espaço que não quebra entre R$ e o número
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))
    pg.goto(U + '#/servicos'); pg.wait_for_selector('tr[data-id]')
    pg.click('tr[data-id] >> nth=0'); pg.wait_for_selector('.tabs')
    ok('#/servico/s1' in pg.url, 'clicar no serviço abre a página dele')
    ok('6 etapas' in pg.inner_text('#aba'), 'aba Dados mostra o escopo')
    ok(pg.locator('#nav a.on').get_attribute('data-r') == 'servicos', 'menu continua marcando Serviços')

    # planos
    pg.click('.tabs [data-a=planos]'); pg.wait_for_selector('#nPlano')
    def plano(nome, preco, itens, a_partir=''):
        pg.click('#nPlano'); pg.wait_for_selector('#dlg[open]')
        pg.fill('#dlgf [name=nome]', nome); pg.fill('#dlgf [name=preco]', preco); pg.fill('#dlgf [name=itens]', itens)
        pg.select_option('#dlgf [name=a_partir]', a_partir); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(300)
    plano('Essencial', '1500', 'Diagnóstico inicial simplificado.\n- Planejamento editorial mensal.\n\nUma reunião estratégica mensal.')
    plano('Avançada', '4000', 'Tudo do Intermediário', '1')
    cards = pg.locator('[data-p]')
    ok(cards.count() == 2, 'dois planos criados')
    ok('R$ 1.500,00' in T(cards.nth(0).inner_text()) and cards.nth(0).locator('li').count() == 3, 'Essencial: preço e 3 itens (linha vazia e "-" ignorados)')
    ok('A partir de R$ 4.000,00' in T(cards.nth(1).inner_text()), 'Avançada: "A partir de"')
    pg.screenshot(path='testes/saida/servico_planos.png')
    cards.nth(1).click(); pg.wait_for_selector('#dlg[open]'); pg.fill('#dlgf [name=preco]', '4500'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(300)
    ok('R$ 4.500,00' in T(pg.locator('[data-p]').nth(1).inner_text()), 'editar o preço do plano')

    # documentos
    pg.click('.tabs [data-a=documentos]'); pg.wait_for_selector('[data-doc]')
    pg.click('[data-doc="0"]'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=documento]', '## Como funcionaria a rotina mensal?\n**Semana 01 — Planejamento**\nReunião com o cliente.')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_selector('[data-pdf]')
    ok(pg.locator('#aba b.tit').first.inner_text() == 'Como funcionaria a rotina mensal?', 'documento mostra o título formatado')
    pg.set_input_files('#arqServ', [{'name': 'Plano Intermediário.docx', 'mimeType': 'application/octet-stream', 'buffer': b'x' * 3000}]); pg.wait_for_timeout(500)
    ok('Plano Intermediário.docx' in pg.inner_text('#aba'), 'arquivo anexado aparece na lista')
    s1 = pg.evaluate("window.__D.crm_servicos[0]")
    ok(s1['arquivos'][0]['caminho'].startswith('servicos/s1/') and s1['planos'][0]['documento'].startswith('## Como'), 'grava planos e arquivos no serviço')
    pg.evaluate("() => { window.print = () => { window.__impresso = document.getElementById('impressao').innerText } }")
    pg.click('[data-pdf="0"]'); pg.wait_for_timeout(300)
    t = pg.evaluate('window.__impresso') or ''
    ok('Essencial' in t and 'Semana 01' in t and 'Diagnóstico inicial' in t, 'PDF do plano tem nome, itens e documento')
    pg.screenshot(path='testes/saida/servico_documentos.png', full_page=True)

    # lista de serviços
    pg.goto(U + '#/servicos'); pg.wait_for_selector('tr[data-id]')
    lista = T(pg.inner_text('main table'))
    ok('Essencial' in lista and 'A partir de R$ 4.500,00' in lista, 'lista de Serviços mostra os planos com preço')

    # proposta: + Do catálogo oferece cada plano
    pg.evaluate("() => { window.__D.crm_propostas.reverse(); location.hash = '#/proposta/pp2' }"); pg.wait_for_selector('#doCat')
    pg.click('#doCat'); pg.wait_for_selector('#dlg[open]')
    opts = [T(o) for o in pg.locator('#dlgf [name=s] option').all_inner_texts()]
    ok(any('Essencial · R$ 1.500,00' in o for o in opts) and not any(o.endswith('R$ 6.000,00') and 'Gestão' in o for o in opts), f'catálogo lista os planos no lugar do preço base: {opts}')
    pg.select_option('#dlgf [name=s]', 's1|0'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(400)
    itens = T(pg.inner_text('#itens'))
    ok('Gestão estratégica da comunicação — Essencial' in itens and '• Diagnóstico inicial' in itens, 'item entra com o nome do plano e o que está incluído')
    ok('## Gestão estratégica da comunicação — Essencial' in pg.input_value('#fCorpo'), 'documento do plano entra no texto da proposta')
    ok('R$ 1.500,00' in itens, 'item com o preço do plano')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
