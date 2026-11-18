# A Sabrina (avatar do site) no CRM: no canto de todas as telas, abre a conversa com a IA, troca de pose;
# na tela Assistente ela fica no topo e some do canto; o menu tem Assistente entre Configurações e Figurinhas.
import sys
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)

def acoes(pg, ctx, chamadas):
    log = lambda t, k: [a for tt, kk, a in pg.evaluate('window.__log') if tt == t and kk == k]
    ultima = lambda: chamadas()[-1]
    # o que ela sabe fazer aparece na tela Assistente
    pg.goto('http://localhost:8777/_mock.html#/assistente'); pg.wait_for_selector('.capac'); pg.wait_for_timeout(400)
    cap = pg.inner_text('.capac')
    ok(all(x in cap for x in ['Fazer por você, com confirmação', 'Escrever', 'Saber onde você está', 'Avisar no celular', '7h30']), 'tela Assistente mostra o que ela sabe fazer')
    pg.click('.capac [data-ex^="Cria uma tarefa"]'); ok(pg.input_value('#chatPagina textarea').startswith('Cria uma tarefa para amanhã'), 'exemplo de ação vai para a caixa para completar')
    pg.fill('#chatPagina textarea', '')
    n = len(chamadas()); pg.click('.capac [data-ex="✦Como está cada projeto?"]'); pg.wait_for_timeout(900); ok(len(chamadas()) == n + 1, 'exemplo de pergunta manda direto')
    pg.screenshot(path='testes/saida/sabrina_capacidades.png')
    # 1) tarefa: cartão; o formulário abre preenchido; só grava ao salvar
    pg.fill('#chatPagina textarea', 'cria uma tarefa pra ligar pra Marina sexta'); pg.keyboard.press('Enter'); pg.wait_for_selector('.acao-ia')
    ok('ligar para a Marina' in pg.inner_text('.acao-ia') and not log('crm_tarefas', 'insert'), 'IA propõe a tarefa num cartão, sem gravar nada')
    pg.click('.acao-ia button'); pg.wait_for_selector('#dlg[open]')
    ok(pg.input_value('#dlgf [name=titulo]') == 'Ligar para a Marina' and pg.input_value('#dlgf [name=prazo]') == '2026-11-20' and pg.input_value('#dlgf [name=prioridade]') == 'alta', 'formulário da tarefa abre preenchido')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_selector('.acao-ia.feita')
    ok(log('crm_tarefas', 'insert') and log('crm_tarefas', 'insert')[-1][0]['titulo'] == 'Ligar para a Marina', 'confirmou: tarefa gravada e o cartão fica como feito')
    # 2) funil: pergunta antes; cancelar não muda nada
    pg.fill('#chatPagina textarea', 'move a Clínica Dias para negociação'); pg.keyboard.press('Enter'); pg.wait_for_selector('.acao-ia >> nth=1')
    ok('(feito)' in ultima()['mensagens'][-2]['content'], 'a IA fica sabendo que a tarefa já foi feita')
    pg.click('.acao-ia >> nth=1 >> button'); pg.wait_for_selector('#dlg[open]'); ok('Negociação' in pg.inner_text('#dlgf h2'), 'mover no funil pede confirmação')
    pg.click('#dlgf button[value=cancelar]'); pg.wait_for_timeout(300)
    ok(not log('crm_oportunidades', 'update') and not pg.locator('.acao-ia >> nth=1').evaluate("e => e.classList.contains('feita')"), 'cancelou: nada muda, o cartão continua')
    pg.click('.acao-ia >> nth=1 >> button'); pg.wait_for_selector('#dlg[open]'); pg.click('#dlgf button[value=ok]'); pg.wait_for_selector('.acao-ia.feita >> nth=1')
    ok(any(a[0].get('etapa') == 'negociacao' for a in log('crm_oportunidades', 'update')), 'confirmou: oportunidade vai para Negociação')
    # 3) WhatsApp e e-mail com o texto pronto
    pg.fill('#chatPagina textarea', 'escreve um whats e um e-mail pro Paulo'); pg.keyboard.press('Enter'); pg.wait_for_selector('.acao-ia >> nth=3')
    pg.click('.acao-ia >> nth=3 >> button'); pg.wait_for_selector('#dlg[open]')
    ok(pg.input_value('#dlgf [name=assunto]') == 'Retorno' and pg.input_value('#dlgf [name=para]') == 'paulo@horizonte.com' and pg.input_value('#dlgf [name=texto]') == 'Oi, Paulo!', 'e-mail abre com assunto, texto e o e-mail do cliente')
    pg.click('#dlgf button[value=cancelar]'); pg.wait_for_timeout(300)
    pg.click('.acao-ia >> nth=2 >> button'); pg.wait_for_selector('#dlg[open]')
    ok(pg.input_value('#dlgf [name=texto]') == 'Oi, Paulo! Tudo bem?', 'WhatsApp abre com a mensagem para revisar')
    ctx.route('https://wa.me/**', lambda r: r.fulfill(body='ok'))
    with ctx.expect_page() as nova: pg.click('#dlgf button[value=ok]')
    ok('wa.me/5516999990000?text=Oi%2C%20Paulo' in nova.value.url, f'WhatsApp abre no número do cliente com +55: {nova.value.url[:70]}')
    nova.value.close(); ok(pg.url.startswith('http://localhost:8777/_mock.html'), 'o CRM continua aberto na aba dele')
    pg.screenshot(path='testes/saida/sabrina_acoes.png')
    # 4) a tela aberta vai junto (Sabrina do canto na ficha do cliente)
    pg.goto('http://localhost:8777/_mock.html#/cliente/c1'); pg.wait_for_selector('.sab-bt'); pg.wait_for_timeout(600)
    pg.click('.sab-bt'); pg.wait_for_selector('#sabJan textarea'); pg.wait_for_timeout(400); pg.fill('#sabJan textarea', 'o que falta aqui?'); pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
    ok(ultima().get('contexto') == {'rota': 'cliente', 'id': 'c1'}, f'na ficha do cliente, a pergunta leva a tela aberta: {ultima().get("contexto")}')

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
        if tela == 'pc': acoes(pg, ctx, chamadas)
        ctx.close()
    ctx = b.new_context(reduced_motion='reduce'); pg = ctx.new_page(); pg.goto('http://localhost:8777/_mock.html#/funil'); pg.wait_for_selector('.sab-bt'); pg.wait_for_timeout(2200)
    ok(pg.locator('.sab-bt video').count() == 0 and pg.locator('.sab-bt img.sab-base').count() == 1, 'menos movimento: imagem parada')
    pg.goto('http://localhost:8777/_mock.html?copia=1#/funil'); pg.wait_for_timeout(1500); ok(pg.locator('.sab-canto').count() == 0, 'cópia completa (quadro invisível): sem a Sabrina')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
