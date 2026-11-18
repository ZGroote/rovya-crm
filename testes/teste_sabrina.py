# A Sabrina (avatar do site) no CRM: no canto de todas as telas, abre a conversa com a IA, troca de pose;
# na tela Assistente ela fica no topo e some do canto; o menu tem Assistente entre Configurações e Figurinhas.
import sys
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    for tela, vp in [('pc', {'width': 1440, 'height': 900}), ('cel', {'width': 390, 'height': 844})]:
        ctx = b.new_context(viewport=vp); pg = ctx.new_page(); pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))
        pg.goto('http://localhost:8777/_mock.html#/funil'); pg.wait_for_selector('.sab-bt'); pg.wait_for_timeout(2600)
        menu = pg.locator('#nav a').all_inner_texts(); menu = [m.split('\n')[-1].strip() for m in menu]
        ok(menu[-3:] == ['Configurações', 'Assistente', 'Figurinhas'], f'[{tela}] menu: Assistente entre Configurações e Figurinhas')
        ok(pg.locator('.sab-bt video').evaluate('v => v.src.endsWith("sabrina-aceno.webm") && !v.paused'), f'[{tela}] Sabrina acenando no canto')
        chamadas = lambda: [x for x in pg.evaluate('window.__ev') if x.get('acao') == 'chat']
        ok(not chamadas(), f'[{tela}] não gasta IA antes de abrir')
        pg.click('.sab-bt'); pg.wait_for_timeout(250)
        ok(pg.is_visible('#sabJan') and 'pensando' in pg.get_attribute('.sab-canto .sab-pose', 'src'), f'[{tela}] abre a janela e ela pensa enquanto a IA responde')
        pg.wait_for_selector('#sabJan .msg.ia:not(.pensando)')
        ok('2 tarefas' in pg.inner_text('#sabJan .msgs') and 'apresentando' in pg.get_attribute('.sab-canto .sab-pose', 'src'), f'[{tela}] resumo do dia chega e ela apresenta')
        pg.fill('#sabJan textarea', 'Quanto tenho a receber?'); pg.keyboard.press('Enter'); pg.wait_for_selector('#sabJan .msg.ia:not(.pensando) >> nth=1')
        ok('R$ 2.000,00' in pg.inner_text('#sabJan .msgs') and len(chamadas()) == 2, f'[{tela}] pergunta e resposta na janelinha')
        box = pg.locator('#sabJan').bounding_box()
        ok(box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= vp['width'], f'[{tela}] janela cabe na tela {box}')
        pg.screenshot(path=f'testes/saida/sabrina_{tela}_janela.png')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(450); ok(not pg.is_visible('#sabJan'), f'[{tela}] Esc fecha')
        pg.goto('http://localhost:8777/_mock.html#/assistente'); pg.wait_for_selector('#chatPagina .msg.ia'); pg.wait_for_timeout(800)
        ok(not pg.is_visible('.sab-canto') and pg.is_visible('.topo-sab .sab'), f'[{tela}] na tela Assistente ela fica no topo, não no canto')
        ok('R$ 2.000,00' in pg.inner_text('#chatPagina') and len(chamadas()) == 2, f'[{tela}] a tela cheia continua a mesma conversa (sem chamar a IA de novo)')
        pg.screenshot(path=f'testes/saida/sabrina_{tela}_tela.png')
        pg.goto('http://localhost:8777/_mock.html#/clientes'); pg.wait_for_selector('.sab-bt'); ok(pg.is_visible('.sab-canto'), f'[{tela}] saiu da tela Assistente: volta ao canto')
        ctx.close()
    ctx = b.new_context(reduced_motion='reduce'); pg = ctx.new_page(); pg.goto('http://localhost:8777/_mock.html#/funil'); pg.wait_for_selector('.sab-bt'); pg.wait_for_timeout(2200)
    ok(pg.locator('.sab-bt video').count() == 0 and pg.locator('.sab-bt img.sab-base').count() == 1, 'menos movimento: imagem parada')
    pg.goto('http://localhost:8777/_mock.html?copia=1#/funil'); pg.wait_for_timeout(1500); ok(pg.locator('.sab-canto').count() == 0, 'cópia completa (quadro invisível): sem a Sabrina')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
