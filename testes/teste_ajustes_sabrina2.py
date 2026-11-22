# Ajustes pedidos pela Sabrina (22/11/2026, 2ª rodada): funil só com os ativos, Instagram clicável e nome real da pasta do Drive.
import sys
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
U = 'http://localhost:8777/_mock.html'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))

    # 1) funil: Fechado e Perdido com os cartões ocultos até ela pedir
    pg.goto(U + '#/clientes'); pg.wait_for_selector('tr[data-id]')
    pg.evaluate("() => { window.__D.crm_oportunidades.push({ id: 'o5', cliente_id: 'c3', titulo: 'Primeira conversa (agenda do site)', etapa: 'perdido', valor: null, ordem: 5, crm_clientes: { nome: 'Carla Dias', empresa: 'Clínica Dias' } }); location.hash = '#/funil'; }")
    pg.wait_for_selector('.col[data-etapa=ganho]')
    ok(pg.locator('.col[data-etapa=ganho] .op').count() == 0 and pg.locator('.col[data-etapa=perdido] .op').count() == 0, 'Fechado e Perdido: cartões ocultos por padrão')
    ok(pg.locator('.col[data-etapa=contato] .op').count() >= 1 and pg.locator('.col[data-etapa=proposta] .op').count() >= 1, 'as etapas ativas continuam com os cartões')
    ok('1 cartão oculto' in pg.inner_text('.col[data-etapa=perdido]') and 'Mostrar encerrados (2)' in pg.inner_text('#verEnc'), 'mostra quantos estão ocultos e o botão "Mostrar encerrados (2)"')
    pg.click('#verEnc'); pg.wait_for_selector('.col[data-etapa=perdido] .op')
    ok(pg.locator('.col[data-etapa=perdido] .op').count() == 1 and pg.locator('.col[data-etapa=ganho] .op').count() == 1 and pg.inner_text('#verEnc') == 'Esconder encerrados', 'Mostrar encerrados traz os cartões de volta')
    pg.click('#verEnc'); pg.wait_for_function("!document.querySelector('.col[data-etapa=perdido] .op')")
    ok(True, 'Esconder encerrados oculta de novo')
    # arrastar para Perdido continua funcionando com os cartões ocultos
    pg.evaluate("""() => { const dt = new DataTransfer(), op = document.querySelector('.op[data-id=o4]'), col = document.querySelector('.col[data-etapa=perdido]');
      op.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); col.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true })); }""")
    pg.wait_for_timeout(500)
    ok(pg.evaluate("window.__log.some(([t, k, a]) => t === 'crm_oportunidades' && k === 'update' && a[0].etapa === 'perdido')"), 'dá para arrastar para Perdido com os cartões ocultos')

    # 2) Instagram: @perfil clicável, venha como vier
    for cadastro, esperado in [('https://www.instagram.com/monicacostacontadora/', 'monicacostacontadora'), ('@horizonte.imoveis', 'horizonte.imoveis'), ('horizonte_imoveis', 'horizonte_imoveis')]:
        pg.evaluate("v => { window.__D.crm_clientes[0].instagram = v; location.hash = '#/clientes'; }", cadastro); pg.wait_for_selector('tr[data-id]')
        pg.evaluate("location.hash = '#/cliente/c1'"); pg.wait_for_selector('#cartaoDrive')
        a = pg.locator('a', has_text='@' + esperado)
        ok(a.count() == 1 and a.get_attribute('href') == f'https://www.instagram.com/{esperado}/' and a.get_attribute('target') == '_blank', f'Instagram "{cadastro}" vira @{esperado} clicável')

    # 3) Drive: nome real da pasta (e o padrão quando não há nome)
    ok('Abrir pasta Horizonte - Cliente' in pg.inner_text('#cartaoDrive'), 'cartão do Drive mostra o nome real da pasta')
    pg.evaluate("() => { window.__D.crm_clientes[0].drive_pasta_nome = null; location.hash = '#/clientes'; }"); pg.wait_for_selector('tr[data-id]')
    pg.evaluate("location.hash = '#/cliente/c1'"); pg.wait_for_selector('#cartaoDrive')
    ok('Abrir pasta CLIENTE_R001' in pg.inner_text('#cartaoDrive'), 'sem nome guardado (e sem Google no teste): fica o nome padrão, sem erro na tela')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
